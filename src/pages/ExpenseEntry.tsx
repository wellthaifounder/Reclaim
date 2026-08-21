// Manual entry — Workstream D6.
//
// Not an escape hatch. The spec is explicit that bank sync structurally cannot
// see medical mileage, cash payments or certain premiums, so this surface is a
// peer of the sync path rather than a fallback from it. Two modes:
//
//   A payment — something you paid for that your bank did not record.
//   Driving   — the per-mile claim, which has no dollar transaction at all.
//
// Both create an Expense directly, skipping Step 1 (categorize) exactly as the
// spec calls for.
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
// 2026-08-21: this is now the ONLY way to create an expense by hand. It
// absorbed the receipt scanning from the five-step wizard that used to live at
// /bills/new — attach a photo and it reads the provider, amount and date off
// it and offers them, which is what the wizard's first three steps did. It
// offers, it does not fill: OCR is a guess about someone's medical paperwork,
// and the spec is explicit that a guess never overwrites silently.
//
// What this is NOT:
//   - An edit form (Phase 5 BillDetail handles edits)
//   - The previous pre-Reclaim version that lived here (700 LOC of
//     payment-plan / reimbursement-strategy / HSA-date wiring; replaced
//     wholesale because it was orphaned, used a stale category list, set
//     no lifecycle/patient fields, and navigated to a non-existent route
//     on success).

import { useRef, useState } from "react";
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
  Camera,
} from "lucide-react";
import { logError } from "@/utils/errorHandler";
import { formatDateOnly } from "@/lib/dates";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import { PatientPicker } from "@/components/family/PatientPicker";
import { MileageEntryForm } from "@/components/expense/MileageEntryForm";
import { Car, Receipt } from "lucide-react";

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

/** What process-receipt-ocr gives back, narrowed to the fields this form has. */
interface OcrSuggestion {
  vendor: string | null;
  serviceDate: string | null;
  date: string | null;
  amount: number | null;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

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
    setValue,
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
  const [scanning, setScanning] = useState(false);
  const [suggestion, setSuggestion] = useState<OcrSuggestion | null>(null);
  // A phone camera and a file browser are the same <input> with a different
  // `capture` attribute, so there are two of them and a button for each.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // A payment and a car trip are different enough that one form serving both
  // would be mostly disabled fields. A savings-calculator hand-off is always a
  // payment, so it never lands on the driving tab.
  const [mode, setMode] = useState<"payment" | "mileage">("payment");

  const watchedCategory = watch("category");

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError("");
    setSuggestion(null);
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
    // Read it straight away. The moment the file is in hand is the moment the
    // user expects something to happen; making them press a second "scan"
    // button is the step the old wizard charged a whole screen for. Images
    // only -- the OCR function takes a picture, not a PDF.
    if (f.type.startsWith("image/")) void runOcr(f);
  };

  /**
   * Ask process-receipt-ocr what it can see, and offer the result.
   *
   * Never writes to the form directly. A misread amount that silently lands in
   * the box is a wrong claim the user had no chance to catch, so everything
   * lands in a banner with the current values still on screen beside it.
   */
  const runOcr = async (f: File) => {
    setScanning(true);
    setSuggestion(null);
    try {
      const imageBase64 = await fileToBase64(f);
      const { data, error } = await supabase.functions.invoke(
        "process-receipt-ocr",
        { body: { imageBase64 } },
      );
      if (error || !data?.success) {
        // Not an error state for the user: they were always going to be able
        // to type this in, and the file is attached either way.
        toast.message("We couldn't read that one — type the details in below.");
        return;
      }
      const r = data.data as OcrSuggestion;
      if (!r?.vendor && r?.amount == null && !(r?.serviceDate ?? r?.date)) {
        toast.message("Nothing legible on that one — type the details in.");
        return;
      }
      setSuggestion(r);
    } catch (err) {
      logError("ExpenseEntry: receipt OCR failed", err);
      toast.message("We couldn't read that one — type the details in below.");
    } finally {
      setScanning(false);
    }
  };

  /** Copy the reading into the form. Only ever runs on an explicit click. */
  const acceptSuggestion = () => {
    if (!suggestion) return;
    if (suggestion.vendor) setValue("vendor", suggestion.vendor);
    if (suggestion.amount != null) setValue("amount", suggestion.amount);
    const scannedDate = suggestion.serviceDate ?? suggestion.date;
    if (scannedDate) setValue("date", scannedDate.slice(0, 10));
    setSuggestion(null);
    toast.success("Details filled in — check them before saving.");
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
          // Workstream D6: the field above is labelled "date of service" and
          // was only ever written to `date`, which is the PAYMENT date. Every
          // gate and the substantiation checklist read `service_date`, so a
          // user who filled the field in was still told the date of care was
          // missing — and the HSA establishment cliff, which turns on date of
          // service, was being tested against the wrong day.
          service_date: data.date,
          category: data.category,
          notes: data.notes?.trim() || null,
          // Workstream C6: without this, a hand-entered expense had no
          // provenance at all, so the duplicate comparison could not tell the
          // user which of two records they had typed themselves.
          source: "manual",
          // Workstream B: is_hsa_eligible and lifecycle_status are derived and
          // reject writes. Category matching is a guess, not a user
          // determination, so eligibility stays 'unknown' until substantiation.
          eligibility_state: "unknown",
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
          // Workstream D6: documentation_state used to be set to 'none' at
          // insert and never revisited, so attaching a receipt here left the
          // expense reporting that it had none. trg_receipts_documentation now
          // owns that column and sees this insert.
          await supabase.from("receipts").insert({
            invoice_id: invoice.id,
            user_id: user.id,
            file_path: filePath,
            file_type: file.type,
            document_type: "bill",
          });
        }
      }

      // Workstream D4: classification moved to substantiation. Deciding the
      // Pub 502 category from a vendor string and a dropdown, before any
      // document or date of service exists, produced a confident-looking
      // answer built on the weakest possible evidence.

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
        navigate("/expenses?tab=to-claim");
        return;
      }

      toast.success("Expense saved.");
      navigate("/expenses?tab=to-claim");
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

        {/* "Have a receipt? Snap it instead" linked to the wizard at
            /bills/new. Scanning happens on this page now, so the link pointed
            at the page it was already on. The camera button moved down to the
            receipt field, which is where someone holding a receipt is looking. */}

        {/* Workstream D6. Driving is given equal billing rather than buried in
            a category dropdown: it is the claim users most often do not know
            they have, and no amount of bank connecting will ever surface it. */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === "payment" ? "default" : "outline"}
            onClick={() => setMode("payment")}
            className="justify-start gap-2"
          >
            <Receipt className="h-4 w-4" />
            Something I paid for
          </Button>
          <Button
            type="button"
            variant={mode === "mileage" ? "default" : "outline"}
            onClick={() => setMode("mileage")}
            className="justify-start gap-2"
          >
            <Car className="h-4 w-4" />
            Driving to care
          </Button>
        </div>

        {mode === "mileage" && <MileageEntryForm />}

        {/* Hidden rather than unmounted: switching tabs to check the other
            form should not throw away what has already been typed. */}
        <Card className={mode === "mileage" ? "hidden" : undefined}>
          <CardHeader>
            <CardTitle>Log an expense</CardTitle>
            <CardDescription>
              For anything your bank didn't record — cash, a cheque, an account
              you haven't connected. Add a photo of the receipt and we'll read
              it for you, or just type it in.
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
                    {scanning ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Reading…
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setFile(null);
                          setSuggestion(null);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Remove file"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      id="receipt"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp"
                      onChange={onFilePicked}
                      className="cursor-pointer"
                    />
                    {/* Same input, camera-first. On a phone this opens the
                        camera rather than the file browser, which is how most
                        receipts get captured. */}
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={onFilePicked}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => cameraInputRef.current?.click()}
                      className="gap-1.5"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Take a photo
                    </Button>
                  </div>
                )}
                {fileError && (
                  <p className="text-xs text-destructive">{fileError}</p>
                )}

                {/* The reading, offered rather than applied. The form keeps
                    whatever is already in it until the user picks. */}
                {suggestion && (
                  <Alert className="mt-2">
                    <Sparkles className="h-4 w-4" />
                    <AlertDescription className="space-y-2">
                      <p className="text-sm">Here's what we read off that:</p>
                      <ul className="text-sm space-y-0.5">
                        {suggestion.vendor && (
                          <li>
                            <span className="text-muted-foreground">
                              Provider:{" "}
                            </span>
                            {suggestion.vendor}
                          </li>
                        )}
                        {suggestion.amount != null && (
                          <li>
                            <span className="text-muted-foreground">
                              Amount:{" "}
                            </span>
                            ${suggestion.amount.toFixed(2)}
                          </li>
                        )}
                        {(suggestion.serviceDate ?? suggestion.date) && (
                          <li>
                            <span className="text-muted-foreground">
                              Date:{" "}
                            </span>
                            {formatDateOnly(
                              suggestion.serviceDate ?? suggestion.date,
                            )}
                          </li>
                        )}
                      </ul>
                      <div className="flex gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          onClick={acceptSuggestion}
                        >
                          Use these
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSuggestion(null)}
                        >
                          I'll type it
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <p className="text-xs text-muted-foreground">
                  PDF, PNG, JPEG, or WebP — up to 10MB. Photos get read
                  automatically. You can also skip this and attach it later.
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
