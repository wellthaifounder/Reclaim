// Reclaim Phase 2 W4 — manual expense entry fallback.
//
// Lightweight no-file-required entry path for users whose expense doesn't
// fit the BillUploadWizard (no receipt, cash purchase, retroactive entry)
// or whose savings-calculator decision needs to be tied to a real expense.
//
// Inserts into `invoices` with `lifecycle_status = 'captured'` and the
// IRS-required patient, selected from the family roster (Workstream D1),
// matching the wizard's data model so downstream Phase 3 classification + Phase 4 Substantiation-Record output
// don't care which surface created the row.
//
// What this is NOT:
//   - The OCR-driven flow (that's BillUploadWizard at /bills/new)
//   - An edit form (Phase 5 BillDetail handles edits)
//   - The previous pre-Reclaim version that lived here (700 LOC of
//     payment-plan / reimbursement-strategy / HSA-date wiring; replaced
//     wholesale because it was orphaned, used a stale category list, set
//     no lifecycle/patient fields, and navigated to a non-existent route
//     on success).

import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Paperclip,
  Sparkles,
  X,
  ArrowLeft,
  ArrowRight,
  Camera,
} from "lucide-react";
import { logError } from "@/utils/errorHandler";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import { PatientPicker } from "@/components/family/PatientPicker";

// Categories match BillUploadWizard so manual-entry and OCR-entry rows
// look consistent in downstream views.
const CATEGORIES = [
  "Medical",
  "Dental",
  "Vision",
  "Mental Health",
  "Pharmacy",
  "Lab / Imaging",
  "Physical Therapy",
  "Other",
] as const;

const HSA_ELIGIBLE_CATEGORIES = new Set([
  "Medical",
  "Dental",
  "Vision",
  "Mental Health",
  "Pharmacy",
  "Lab / Imaging",
  "Physical Therapy",
]);

const expenseSchema = z.object({
  date: z.string().min(1, "Date is required"),
  vendor: z.string().trim().min(1, "Vendor is required").max(100),
  amount: z
    .number({ invalid_type_error: "Amount is required" })
    .positive("Amount must be greater than 0"),
  category: z.string().min(1, "Category is required"),
  notes: z.string().max(500).optional(),
});
type ExpenseFormValues = z.infer<typeof expenseSchema>;

interface SavedDecisionState {
  amount?: number | string;
  category?: string;
  recommendation?: { method?: string; reasoning?: string };
}

interface LocationState {
  savedDecision?: SavedDecisionState;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB, mirrors wizard
const ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export default function ExpenseEntry() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const savedDecision = state.savedDecision;

  // Prefill amount + category from a pre-purchase savings-calculator decision
  // if the user arrived here via PrePurchaseDecision's "Enter Expense Now" CTA.
  const decisionAmount =
    typeof savedDecision?.amount === "string"
      ? parseFloat(savedDecision.amount) || undefined
      : savedDecision?.amount;
  const decisionCategory =
    savedDecision?.category &&
    CATEGORIES.includes(savedDecision.category as never)
      ? (savedDecision.category as string)
      : "";

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      vendor: "",
      amount: decisionAmount as number | undefined,
      category: decisionCategory,
      notes: "",
    },
  });

  // Workstream D1: the patient is a roster member, not a typed string. The
  // account holder is preselected because it is by far the commonest case.
  const { self: rosterSelf } = useFamilyRoster();
  const [patientId, setPatientId] = useState<string | null>(null);
  const effectivePatientId = patientId ?? rosterSelf?.id ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const watchedCategory = watch("category");

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError("");
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setFile(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(f.type)) {
      setFileError("Receipt must be PDF, PNG, JPEG, or WebP.");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError("Receipt exceeds 10MB.");
      return;
    }
    setFile(f);
  };

  const onSubmit = async (data: ExpenseFormValues) => {
    setSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in to add an expense.");

      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          user_id: user.id,
          vendor: data.vendor.trim(),
          amount: data.amount,
          date: data.date,
          category: data.category,
          notes: data.notes?.trim() || null,
          // Workstream B: is_hsa_eligible and lifecycle_status are derived and
          // reject writes. Category matching is a guess, not a user
          // determination, so eligibility stays 'unknown' until substantiation.
          eligibility_state: "unknown",
          documentation_state: "none",
          claim_state: "unclaimed",
          amount_paid: data.amount,
          reimbursable_amount: data.amount,
          // patient_name is kept in step by a database trigger, so the ten
          // surfaces still reading it keep working while they migrate.
          patient_id: effectivePatientId,
        })
        .select("id")
        .single();
      if (invErr || !invoice) throw invErr ?? new Error("Insert failed");

      // Optional receipt — single file, no OCR (this surface is the no-OCR
      // fallback). Wizard remains the OCR-driven path.
      if (file) {
        const filePath = `${user.id}/${invoice.id}/${Date.now()}-${file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from("receipts")
          .upload(filePath, file);
        if (uploadErr) {
          // Don't roll back the invoice — the expense is more important than
          // the attachment. Surface the partial failure to the user.
          logError("ExpenseEntry: receipt upload failed", uploadErr);
          toast.warning(
            "Expense saved, but the receipt couldn't be uploaded. You can attach it later from the bill detail page.",
          );
        } else {
          await supabase.from("receipts").insert({
            invoice_id: invoice.id,
            user_id: user.id,
            file_path: filePath,
            file_type: file.type,
            document_type: "bill",
          });
        }
      }

      // Reclaim Phase 3: fire classify-expense (fire-and-forget). The
      // expense lands in the review queue (PENDING_REVIEW or NEEDS_RECEIPT)
      // by the time the user navigates there next.
      supabase.functions
        .invoke("classify-expense", { body: { invoice_id: invoice.id } })
        .catch((err) =>
          console.warn(
            "[ExpenseEntry] classify-expense invocation failed:",
            err?.message,
          ),
        );

      // Workstream C6: the spec requires duplicate detection to fire on manual
      // entry against already-synced transactions, not only on sync. This is
      // the moment it matters — the user has just hand-entered a charge their
      // bank may already have delivered, and telling them now is far better
      // than letting two claimable records sit until they build a request.
      const { data: dupes, error: dupeErr } = await supabase.rpc(
        "detect_duplicate_expenses",
        { p_user_id: user.id },
      );
      if (dupeErr) {
        logError("ExpenseEntry: duplicate detection failed", dupeErr);
      } else if ((dupes ?? 0) > 0) {
        toast.warning(
          "Expense saved. It looks like one you already have — check Possible duplicates under Transactions → Review.",
          { duration: 8000 },
        );
        navigate("/bills");
        return;
      }

      toast.success("Expense saved.");
      navigate("/bills");
    } catch (error) {
      logError("ExpenseEntry submit", error);
      toast.error("Failed to save expense. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthenticatedLayout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        {/* Symmetric escape hatch to the scan-driven wizard. The two surfaces
            link to each other so users can switch capture modes mid-thought
            without backtracking. Brief §1 kill-shot is scanning, so manual
            users get a gentle nudge toward the higher-value path when they
            do have a receipt. */}
        <div className="mb-4 text-center">
          <button
            type="button"
            onClick={() => navigate("/bills/new")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Camera className="h-3.5 w-3.5" />
            Have a receipt? Snap it instead
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Log an expense</CardTitle>
            <CardDescription>
              No receipt to scan? Type it in here. We'll mark it for your
              review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {savedDecision && (
              <Alert className="mb-6 border-violet-200 bg-violet-50">
                <Sparkles className="h-4 w-4 text-violet-600" />
                <AlertDescription className="text-violet-900">
                  Pre-filled from your savings-calculator decision
                  {savedDecision.recommendation?.method
                    ? ` (${savedDecision.recommendation.method})`
                    : ""}
                  . Adjust anything below before saving.
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="date">Date of service</Label>
                  <Input id="date" type="date" {...register("date")} />
                  {errors.date && (
                    <p className="text-xs text-destructive">
                      {errors.date.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className="pl-7"
                      {...register("amount", { valueAsNumber: true })}
                    />
                  </div>
                  {errors.amount && (
                    <p className="text-xs text-destructive">
                      {errors.amount.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vendor">Provider / Vendor</Label>
                <Input
                  id="vendor"
                  placeholder="e.g. City Medical Center"
                  maxLength={100}
                  {...register("vendor")}
                />
                {errors.vendor && (
                  <p className="text-xs text-destructive">
                    {errors.vendor.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="patient">Patient</Label>
                <PatientPicker
                  id="patient"
                  value={effectivePatientId}
                  onChange={setPatientId}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Category</Label>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.category && (
                  <p className="text-xs text-destructive">
                    {errors.category.message}
                  </p>
                )}
                {watchedCategory &&
                  HSA_ELIGIBLE_CATEGORIES.has(watchedCategory) && (
                    <p className="text-xs text-teal-700">
                      Categorized as HSA-eligible. You'll confirm during review.
                    </p>
                  )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Anything you want to remember about this expense"
                  maxLength={500}
                  rows={3}
                  {...register("notes")}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt">Receipt (optional)</Label>
                {file ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Input
                    id="receipt"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    onChange={onFilePicked}
                    className="cursor-pointer"
                  />
                )}
                {fileError && (
                  <p className="text-xs text-destructive">{fileError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  PDF, PNG, JPEG, or WebP — up to 10MB. Or skip and add it later
                  from the bill detail page.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                  disabled={submitting}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save Expense"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AuthenticatedLayout>
  );
}
