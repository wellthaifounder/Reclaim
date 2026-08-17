import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderHeart,
  Plus,
  ZoomIn,
  Sparkles,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useDropzone } from "react-dropzone";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useFamilyRoster } from "@/hooks/useFamilyRoster";
import { PatientPicker } from "@/components/family/PatientPicker";
import { toast } from "sonner";

// ── Constants ──────────────────────────────────────────────────────────────────

const ALLOWED_FILE_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;

const HSA_ELIGIBLE_CATEGORIES = [
  "Medical",
  "Dental",
  "Vision",
  "Mental Health",
  "Pharmacy",
  "Lab / Imaging",
  "Physical Therapy",
];

const CATEGORIES = [
  "Medical",
  "Dental",
  "Vision",
  "Mental Health",
  "Pharmacy",
  "Lab / Imaging",
  "Physical Therapy",
  "Other",
];

const DOCUMENT_TYPES = [
  { value: "bill", label: "Medical Bill" },
  { value: "itemized_statement", label: "Itemized Statement" },
  { value: "eob", label: "Explanation of Benefits (EOB)" },
  { value: "payment_receipt", label: "Payment Receipt" },
  { value: "other", label: "Other" },
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface FileEntry {
  file: File;
  objectUrl: string;
}

// Reclaim Phase 2: shape returned by process-receipt-ocr.
interface OcrResult {
  amount: number | null;
  vendor: string | null;
  date: string | null;
  category: string | null;
  isHSAEligible: boolean;
  confidence: number;
  invoiceNumber: string | null;
  insurance: string | null;
  serviceDate: string | null;
  billDate: string | null;
  metadataConfidence: number;
  warnings: string[];
  rawResponse: string;
}

interface BillDraft {
  file: File;
  objectUrl: string;
  documentType: string;
  documentName: string;
  vendor: string;
  amount: string;
  date: string;
  category: string;
  invoiceNumber: string;
  collectionId: string | null;
  newCollectionTitle: string;
  isCreatingNewCollection: boolean;
  notes: string;
  /** Workstream D1: a family_members id, not a typed name. */
  patientId: string | null;
}

type Step = "upload" | "details" | "review" | "saving" | "complete" | "error";

interface BillUploadWizardProps {
  onComplete?: (invoiceId: string) => void;
  onCancel?: () => void;
}

// ── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ["Upload", "Confirm", "Saved"] as const;

function StepIndicator({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-3 border-b">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                i < activeStep
                  ? "bg-primary text-primary-foreground"
                  : i === activeStep
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {i < activeStep ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                "text-xs font-medium",
                i <= activeStep ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div
              className={cn(
                "h-px w-8",
                i < activeStep ? "bg-primary" : "bg-muted-foreground/25",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function BillUploadWizard({
  onComplete,
  onCancel,
}: BillUploadWizardProps) {
  const isMobile = useIsMobile();
  const [step, setStep] = useState<Step>("upload");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  // Workstream D1: patients come from the family roster. `rosterSelf` is the
  // fallback when a draft has no explicit choice, since most bills are the
  // account holder's own.
  const { members: rosterMembers, self: rosterSelf } = useFamilyRoster();
  const [drafts, setDrafts] = useState<BillDraft[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [collections, setCollections] = useState<
    { id: string; title: string }[]
  >([]);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [showCollectionSection, setShowCollectionSection] = useState(false);

  const [savingIndex, setSavingIndex] = useState(0);
  const [savedInvoices, setSavedInvoices] = useState<
    { id: string; vendor: string; amount: string }[]
  >([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Coach marks — shown once per user on their first upload
  const [showCoachMarks, setShowCoachMarks] = useState(() => {
    return localStorage.getItem("billUploadCoachSeen") !== "true";
  });
  const dismissCoachMarks = () => {
    setShowCoachMarks(false);
    localStorage.setItem("billUploadCoachSeen", "true");
  };

  // OCR state — tracks scanning progress and which fields were AI-filled per draft
  const [ocrStatus, setOcrStatus] = useState<
    Record<number, "loading" | "done" | "error" | "skipped">
  >({});
  const [ocrFields, setOcrFields] = useState<
    Record<
      number,
      Array<"vendor" | "amount" | "date" | "category" | "invoiceNumber">
    >
  >({});
  // Reclaim Phase 2: keep the full OCR extraction so we can persist it to
  // receipt_ocr_data on save and so each OCR'd invoice can start in
  // PENDING_REVIEW rather than CAPTURED.
  const [ocrResults, setOcrResults] = useState<Record<number, OcrResult>>({});

  // Sync collection section visibility when navigating between drafts
  const prevIndexRef = useRef(-1);
  useEffect(() => {
    if (prevIndexRef.current !== currentIndex) {
      prevIndexRef.current = currentIndex;
      const d = drafts[currentIndex];
      if (d) {
        setShowCollectionSection(
          !!d.collectionId ||
            !!d.newCollectionTitle ||
            d.isCreatingNewCollection,
        );
      } else {
        setShowCollectionSection(false);
      }
    }
  }, [currentIndex, drafts]);

  // ── Dropzone ────────────────────────────────────────────────────────────────

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const oversized = acceptedFiles.filter((f) => f.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        toast.error("File too large", {
          description: `${oversized[0].name} exceeds 10MB`,
        });
      }
      const valid = acceptedFiles.filter((f) => f.size <= MAX_FILE_SIZE);
      const newEntries: FileEntry[] = valid.map((f) => ({
        file: f,
        objectUrl: URL.createObjectURL(f),
      }));
      setFileEntries((prev) => {
        const combined = [...prev, ...newEntries];
        if (combined.length > MAX_FILES) {
          combined
            .slice(MAX_FILES)
            .forEach((e) => URL.revokeObjectURL(e.objectUrl));
          return combined.slice(0, MAX_FILES);
        }
        return combined;
      });
    },
    [toast],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ALLOWED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  });

  const removeFile = (index: number) => {
    URL.revokeObjectURL(fileEntries[index].objectUrl);
    setFileEntries((prev) => prev.filter((_, i) => i !== index));
  };

  // ── OCR ─────────────────────────────────────────────────────────────────────

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const runOCR = async (index: number, file: File) => {
    if (!file.type.startsWith("image/")) {
      setOcrStatus((prev) => ({ ...prev, [index]: "skipped" }));
      return;
    }
    setOcrStatus((prev) => ({ ...prev, [index]: "loading" }));
    try {
      const imageBase64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke(
        "process-receipt-ocr",
        {
          body: { imageBase64 },
        },
      );
      if (error || !data?.success) {
        setOcrStatus((prev) => ({ ...prev, [index]: "error" }));
        return;
      }
      const extracted = data.data as OcrResult;
      const today = new Date().toISOString().split("T")[0];
      const filled: Array<
        "vendor" | "amount" | "date" | "category" | "invoiceNumber"
      > = [];
      setDrafts((prev) =>
        prev.map((d, i) => {
          if (i !== index) return d;
          const updates: Partial<BillDraft> = {};
          if (extracted.vendor && !d.vendor) {
            updates.vendor = extracted.vendor;
            filled.push("vendor");
          }
          if (extracted.amount != null && !d.amount) {
            updates.amount = extracted.amount.toFixed(2);
            filled.push("amount");
          }
          // Prefer the service date for Reclaim Substantiation Records (IRS Pub
          // 502 asks for date of service, not bill date). Fall back to the
          // generic `date` field if Gemini couldn't isolate one.
          const ocrDate = extracted.serviceDate || extracted.date;
          if (ocrDate && d.date === today) {
            updates.date = ocrDate;
            filled.push("date");
          }
          if (
            extracted.category &&
            CATEGORIES.includes(extracted.category) &&
            d.category === "Medical"
          ) {
            updates.category = extracted.category;
            filled.push("category");
          }
          if (extracted.invoiceNumber && !d.invoiceNumber) {
            updates.invoiceNumber = extracted.invoiceNumber;
            filled.push("invoiceNumber");
          }
          return { ...d, ...updates };
        }),
      );
      setOcrFields((prev) => ({ ...prev, [index]: filled }));
      setOcrResults((prev) => ({ ...prev, [index]: extracted }));
      setOcrStatus((prev) => ({ ...prev, [index]: "done" }));
    } catch {
      setOcrStatus((prev) => ({ ...prev, [index]: "error" }));
    }
  };

  // ── Transition: upload → details ────────────────────────────────────────────

  const handleContinue = () => {
    const today = new Date().toISOString().split("T")[0];
    const newDrafts: BillDraft[] = fileEntries.map((entry) => ({
      file: entry.file,
      objectUrl: entry.objectUrl,
      documentType: "bill",
      documentName: "",
      vendor: "",
      amount: "",
      date: today,
      category: "Medical",
      invoiceNumber: "",
      collectionId: null,
      newCollectionTitle: "",
      isCreatingNewCollection: false,
      notes: "",
      patientId: null,
    }));
    setDrafts(newDrafts);
    setCurrentIndex(0);
    prevIndexRef.current = -1;
    setShowCollectionSection(false);
    setOcrStatus({});
    setOcrFields({});
    setOcrResults({});
    setStep("details");
    // Kick off OCR for all image files immediately — results pre-populate fields
    newDrafts.forEach((d, i) => runOCR(i, d.file));
  };

  // ── Draft helpers ────────────────────────────────────────────────────────────

  const updateDraft = (index: number, updates: Partial<BillDraft>) => {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...updates } : d)),
    );
  };

  const draft = drafts[currentIndex];
  const isLastFile = currentIndex === drafts.length - 1;
  // All fields are optional — always allow proceeding
  const isDraftValid = !!draft;

  // ── Collections ─────────────────────────────────────────────────────────────

  const loadCollections = async () => {
    if (collectionsLoaded) return;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("collections")
        .select("id, title")
        .eq("user_id", user.id)
        .order("title");
      setCollections(data ?? []);
    } catch {
      // silently fail — user can still create a new care event
    } finally {
      setCollectionsLoaded(true);
    }
  };

  const handleToggleCollectionSection = () => {
    if (!showCollectionSection) loadCollections();
    setShowCollectionSection((v) => !v);
  };

  // ── Navigation ────────────────────────────────────────────────────────────────

  const handleBack = () => {
    if (currentIndex === 0) {
      setStep("upload");
    } else {
      setCurrentIndex((i) => i - 1);
    }
  };

  const handleNext = () => {
    if (isLastFile) {
      setStep("review");
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setStep("saving");
    setSavingIndex(0);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in to upload bills");

      // ── Duplicate detection ──────────────────────────────────────────────
      // Check for existing bills with matching vendor + amount + date
      const dupChecks = drafts
        .filter((d) => d.vendor.trim() && d.amount && d.date)
        .map((d) => ({
          vendor: d.vendor.trim().toLowerCase(),
          amount: parseFloat(d.amount),
          date: d.date,
        }));

      if (dupChecks.length > 0) {
        const { data: existing } = await supabase
          .from("invoices")
          .select("vendor, amount, date")
          .eq("user_id", user.id)
          .limit(500);

        if (existing) {
          const dupes = dupChecks.filter((check) =>
            existing.some(
              (inv) =>
                inv.vendor.toLowerCase() === check.vendor &&
                Math.abs(Number(inv.amount) - check.amount) < 0.01 &&
                inv.date === check.date,
            ),
          );
          if (dupes.length > 0) {
            toast.warning(
              `Possible duplicate: ${dupes[0].vendor} ($${dupes[0].amount.toFixed(2)}) on ${new Date(dupes[0].date + "T00:00:00").toLocaleDateString()} already exists. Saving anyway.`,
            );
          }
        }
      }

      const results: { id: string; vendor: string; amount: string }[] = [];

      for (let i = 0; i < drafts.length; i++) {
        setSavingIndex(i + 1);
        const d = drafts[i];

        // 1. Resolve collection_id — create new if needed
        let collectionId = d.collectionId;
        if (!collectionId && d.newCollectionTitle.trim()) {
          const { data: col, error: colErr } = await supabase
            .from("collections")
            .insert({ user_id: user.id, title: d.newCollectionTitle.trim() })
            .select("id")
            .single();
          if (colErr) throw colErr;
          collectionId = col.id;
        }

        // 2. Insert invoice — all metadata fields are optional
        const vendor = d.vendor.trim() || d.file.name.replace(/\.[^.]+$/, "");
        const amount = d.amount !== "" ? parseFloat(d.amount) : 0;
        const date = d.date || new Date().toISOString().split("T")[0];
        // Workstream B: the old `isHsaEligible` (category matching) and
        // `lifecycleStatus` locals are gone — both columns are now derived from
        // the facets set below, and category matching is a guess rather than
        // the explicit user confirmation that earns 'eligible'.
        const ocrExtraction = ocrResults[i];
        const { data: invoice, error: invoiceErr } = await supabase
          .from("invoices")
          .insert({
            user_id: user.id,
            vendor,
            amount,
            date,
            category: d.category || "Other",
            invoice_number: d.invoiceNumber.trim() || null,
            collection_id: collectionId || null,
            notes: d.notes.trim() || null,
            // Workstream B: is_hsa_eligible and lifecycle_status are derived
            // and reject writes. This wizard always attaches a document, so
            // documentation_state is 'complete'; eligibility is left 'unknown'
            // for substantiation to resolve.
            eligibility_state: "unknown",
            documentation_state: "complete",
            claim_state: "unclaimed",
            amount_paid: amount,
            reimbursable_amount: amount,
            // patient_name is kept in step by a database trigger, so the
            // surfaces still reading it keep working while they migrate.
            patient_id: d.patientId ?? rosterSelf?.id ?? null,
          })
          .select()
          .single();
        if (invoiceErr) throw invoiceErr;

        // 3. Upload file to storage
        const fileName = `${Date.now()}-${d.file.name}`;
        const filePath = `${user.id}/${invoice.id}/${fileName}`;
        const { error: uploadErr } = await supabase.storage
          .from("receipts")
          .upload(filePath, d.file);
        if (uploadErr) throw uploadErr;

        // 4. Insert receipt record
        const { data: receipt, error: receiptErr } = await supabase
          .from("receipts")
          .insert({
            invoice_id: invoice.id,
            user_id: user.id,
            file_path: filePath,
            file_type: d.file.type,
            document_type: d.documentType,
            description: d.documentName.trim() || null,
          })
          .select("id")
          .single();
        if (receiptErr) throw receiptErr;

        // 5. Persist OCR extraction to receipt_ocr_data when present.
        // Best-effort: failure here should not abort the save — the invoice
        // and receipt are already committed and the OCR data is metadata.
        if (ocrExtraction && receipt) {
          const { error: ocrPersistErr } = await supabase
            .from("receipt_ocr_data")
            .insert({
              receipt_id: receipt.id,
              extracted_amount: ocrExtraction.amount,
              extracted_vendor: ocrExtraction.vendor,
              extracted_date: ocrExtraction.date,
              extracted_category: ocrExtraction.category,
              confidence_score: ocrExtraction.confidence,
              extracted_invoice_number: ocrExtraction.invoiceNumber,
              extracted_insurance: ocrExtraction.insurance,
              extracted_service_date: ocrExtraction.serviceDate,
              extracted_bill_date: ocrExtraction.billDate,
              metadata_confidence: ocrExtraction.metadataConfidence,
              extraction_warnings: ocrExtraction.warnings,
              raw_response: ocrExtraction.rawResponse,
            });
          if (ocrPersistErr) {
            console.warn(
              "[BillUploadWizard] receipt_ocr_data insert failed; continuing.",
              ocrPersistErr.message,
            );
          }
        }

        results.push({ id: invoice.id, vendor, amount: d.amount || "0" });
      }

      setSavedInvoices(results);
      if (onComplete && results.length > 0) onComplete(results[0].id);
      setStep("complete");

      // Workstream D4: classification deliberately does NOT run here any more.
      // Gate 3 asks what KIND of expense this is under Pub 502, and at capture
      // time the answer rests on a vendor name and a category the user picked
      // from a dropdown. The date of service, the patient and the documents --
      // the things that actually decide it -- arrive during substantiation, so
      // that is where it runs now.
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : ((error as { message?: string })?.message ?? "Upload failed");
      setErrorMessage(msg);
      setStep("error");
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────────

  const handleReset = () => {
    fileEntries.forEach((e) => URL.revokeObjectURL(e.objectUrl));
    setStep("upload");
    setFileEntries([]);
    setDrafts([]);
    setCurrentIndex(0);
    prevIndexRef.current = -1;
    setCollections([]);
    setCollectionsLoaded(false);
    setShowCollectionSection(false);
    setSavingIndex(0);
    setSavedInvoices([]);
    setErrorMessage("");
    setOcrStatus({});
    setOcrFields({});
    setOcrResults({});
  };

  const isImageFile = (file: File) => file.type.startsWith("image/");

  // ──────────────────────────────────────────────────────────────────────────────
  // STEP: Upload
  // ──────────────────────────────────────────────────────────────────────────────

  if (step === "upload") {
    return (
      <Card>
        <StepIndicator activeStep={0} />
        <CardContent className="p-6 space-y-6">
          {/* Drop zone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50",
            )}
          >
            {/* Reclaim: camera-first on mobile — opens device camera by default while
                still letting the user pick from the gallery via the camera UI. */}
            <input
              {...getInputProps({
                capture: isMobile ? "environment" : undefined,
              })}
            />
            <Upload
              className={cn(
                "h-10 w-10 mx-auto mb-3",
                isDragActive ? "text-primary" : "text-muted-foreground",
              )}
            />
            <p className="font-medium mb-1">
              {isDragActive
                ? "Drop files here"
                : isMobile
                  ? "Add a document"
                  : "Upload documents"}
            </p>
            <p className="text-sm text-muted-foreground">
              {isMobile
                ? "Take a photo or choose a file"
                : "Drag & drop or click to browse"}{" "}
              · PDF, PNG, JPG up to 10MB · up to {MAX_FILES} files
            </p>
          </div>

          {/* File preview grid */}
          {fileEntries.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {fileEntries.length}
                </span>{" "}
                file
                {fileEntries.length > 1 ? "s" : ""} selected — you'll enter
                details for each on the next step.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {fileEntries.map((entry, i) => (
                  <div
                    key={i}
                    className="relative group rounded-lg border overflow-hidden bg-muted"
                  >
                    {isImageFile(entry.file) ? (
                      <img
                        src={entry.objectUrl}
                        alt={entry.file.name}
                        className="w-full h-24 object-cover"
                      />
                    ) : (
                      <div className="w-full h-24 flex items-center justify-center">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(i);
                      }}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/90 border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="px-2 py-1.5 border-t">
                      <p className="text-xs truncate">{entry.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(entry.file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {onCancel && (
              <Button variant="outline" onClick={onCancel} className="flex-1">
                Cancel
              </Button>
            )}
            <Button
              onClick={handleContinue}
              disabled={fileEntries.length === 0}
              className="flex-1"
            >
              Continue →
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // STEP: Details
  // ──────────────────────────────────────────────────────────────────────────────

  if (step === "details" && draft) {
    const collectionLabel = draft.collectionId
      ? collections.find((c) => c.id === draft.collectionId)?.title
      : draft.newCollectionTitle || null;

    return (
      <Card>
        <StepIndicator activeStep={1} />
        <CardContent className="p-0">
          {/* Progress header */}
          <div className="border-b px-6 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Bill {currentIndex + 1} of {drafts.length}
            </span>
            <div className="flex items-center gap-1.5">
              {drafts.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200",
                    i === currentIndex
                      ? "w-6 bg-primary"
                      : i < currentIndex
                        ? "w-3 bg-primary/50"
                        : "w-3 bg-muted-foreground/25",
                  )}
                />
              ))}
            </div>
          </div>

          {/* Side-by-side body */}
          <div className="flex flex-col md:flex-row">
            {/* Lightbox */}
            <Dialog
              open={!!lightboxUrl}
              onOpenChange={(open) => !open && setLightboxUrl(null)}
            >
              <DialogContent className="max-w-5xl w-full p-2 bg-black/90 border-0">
                {lightboxUrl && (
                  <img
                    src={lightboxUrl}
                    alt="Full size preview"
                    className="w-full max-h-[90vh] object-contain rounded"
                  />
                )}
              </DialogContent>
            </Dialog>

            {/* Left: Document preview */}
            <div className="md:w-[42%] border-b md:border-b-0 md:border-r bg-muted/20 flex flex-col items-center justify-center p-6 min-h-[220px]">
              {isImageFile(draft.file) ? (
                <div className="relative w-full group">
                  <img
                    src={draft.objectUrl}
                    alt={draft.file.name}
                    className="w-full max-h-[380px] object-contain rounded shadow-sm cursor-zoom-in"
                    onClick={() => setLightboxUrl(draft.objectUrl)}
                  />
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(draft.objectUrl)}
                    className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/80 border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    title="Expand image"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="h-20 w-20 rounded-xl bg-muted flex items-center justify-center">
                    <FileText className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium break-all px-2">
                      {draft.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(draft.file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(draft.objectUrl, "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open PDF
                  </Button>
                </div>
              )}
            </div>

            {/* Right: Intake form */}
            <div className="md:w-[58%] p-6 space-y-4 overflow-y-auto max-h-[580px]">
              {/* OCR status banner */}
              {ocrStatus[currentIndex] === "loading" && (
                <div className="flex items-center gap-2 text-sm text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  Scanning with AI — fields will fill automatically…
                </div>
              )}
              {ocrStatus[currentIndex] === "done" &&
                (ocrFields[currentIndex]?.length ?? 0) > 0 && (
                  <div className="flex items-center gap-2 text-sm text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    AI extracted {ocrFields[currentIndex].length} field
                    {ocrFields[currentIndex].length > 1 ? "s" : ""} — review and
                    correct as needed.
                  </div>
                )}

              {/* Document Type */}
              <div className="space-y-1.5">
                <Label>Document Type</Label>
                <Select
                  value={draft.documentType}
                  onValueChange={(v) =>
                    updateDraft(currentIndex, { documentType: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Document Name */}
              <div className="space-y-1.5">
                <Label htmlFor={`documentName-${currentIndex}`}>
                  Document Name{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (optional)
                  </span>
                </Label>
                <Input
                  id={`documentName-${currentIndex}`}
                  placeholder={`e.g. ER Visit Bill, EOB March 2026`}
                  value={draft.documentName}
                  onChange={(e) =>
                    updateDraft(currentIndex, { documentName: e.target.value })
                  }
                />
              </div>

              {/* Provider */}
              <div className="space-y-1.5">
                <Label
                  htmlFor={`vendor-${currentIndex}`}
                  className="flex items-center gap-1.5"
                >
                  Provider / Vendor
                  {ocrFields[currentIndex]?.includes("vendor") && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-violet-600">
                      <Sparkles className="h-2.5 w-2.5" />
                      AI
                    </span>
                  )}
                </Label>
                <Input
                  id={`vendor-${currentIndex}`}
                  placeholder="e.g. City Medical Center"
                  value={draft.vendor}
                  onChange={(e) =>
                    updateDraft(currentIndex, { vendor: e.target.value })
                  }
                />
              </div>

              {/* Patient — required on Reclaim Substantiation Records (IRS Pub 502) */}
              <div className="space-y-1.5">
                <Label htmlFor={`patient-${currentIndex}`}>Patient</Label>
                <PatientPicker
                  id={`patient-${currentIndex}`}
                  value={draft.patientId ?? rosterSelf?.id ?? null}
                  onChange={(patientId) =>
                    updateDraft(currentIndex, { patientId })
                  }
                />
              </div>

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`amount-${currentIndex}`}
                    className="flex items-center gap-1.5"
                  >
                    Amount
                    {ocrFields[currentIndex]?.includes("amount") && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-violet-600">
                        <Sparkles className="h-2.5 w-2.5" />
                        AI
                      </span>
                    )}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
                    <Input
                      id={`amount-${currentIndex}`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-7"
                      value={draft.amount}
                      onChange={(e) =>
                        updateDraft(currentIndex, { amount: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`date-${currentIndex}`}
                    className="flex items-center gap-1.5"
                  >
                    Date
                    {ocrFields[currentIndex]?.includes("date") && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-violet-600">
                        <Sparkles className="h-2.5 w-2.5" />
                        AI
                      </span>
                    )}
                  </Label>
                  <Input
                    id={`date-${currentIndex}`}
                    type="date"
                    value={draft.date}
                    onChange={(e) =>
                      updateDraft(currentIndex, { date: e.target.value })
                    }
                  />
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    Category
                    {ocrFields[currentIndex]?.includes("category") && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-violet-600">
                        <Sparkles className="h-2.5 w-2.5" />
                        AI
                      </span>
                    )}
                  </Label>
                  {HSA_ELIGIBLE_CATEGORIES.includes(draft.category) && (
                    <Badge className="text-xs bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-50">
                      HSA Eligible
                    </Badge>
                  )}
                </div>
                <Select
                  value={draft.category}
                  onValueChange={(v) =>
                    updateDraft(currentIndex, { category: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showCoachMarks && currentIndex === 0 && (
                  <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 mt-1.5">
                    <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      Category determines HSA eligibility. Medical, Dental,
                      Vision, and similar categories are automatically
                      HSA-eligible.
                    </span>
                    <button
                      type="button"
                      onClick={dismissCoachMarks}
                      className="text-blue-500 hover:text-blue-700 shrink-0 ml-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Care event picker */}
              <div className="space-y-2">
                {!showCollectionSection ? (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={handleToggleCollectionSection}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add to a Care Event
                      {collectionLabel && (
                        <span className="text-primary font-medium ml-0.5">
                          · {collectionLabel}
                        </span>
                      )}
                    </button>
                    {showCoachMarks && currentIndex === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Group related bills (e.g. "Knee Surgery 2026") to track
                        an episode of care across multiple visits.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-1.5 text-sm">
                        <FolderHeart className="h-4 w-4 text-primary" />
                        Care Event
                      </Label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCollectionSection(false);
                          updateDraft(currentIndex, {
                            collectionId: null,
                            newCollectionTitle: "",
                            isCreatingNewCollection: false,
                          });
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Remove
                      </button>
                    </div>
                    <Select
                      value={
                        draft.collectionId ??
                        (draft.isCreatingNewCollection ? "__new__" : "__none__")
                      }
                      onValueChange={(v) => {
                        if (v === "__new__") {
                          updateDraft(currentIndex, {
                            collectionId: null,
                            isCreatingNewCollection: true,
                          });
                        } else if (v === "__none__") {
                          updateDraft(currentIndex, {
                            collectionId: null,
                            newCollectionTitle: "",
                            isCreatingNewCollection: false,
                          });
                        } else {
                          updateDraft(currentIndex, {
                            collectionId: v,
                            newCollectionTitle: "",
                            isCreatingNewCollection: false,
                          });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select or create a care event…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {collections.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.title}
                          </SelectItem>
                        ))}
                        <SelectItem value="__new__">
                          ＋ Create new care event…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {draft.isCreatingNewCollection && (
                      <Input
                        placeholder="Care event name (e.g. Knee Surgery 2026)"
                        value={draft.newCollectionTitle}
                        onChange={(e) =>
                          updateDraft(currentIndex, {
                            newCollectionTitle: e.target.value,
                          })
                        }
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Advanced fields — collapsed by default */}
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform [[data-state=open]>&]:rotate-90" />
                  More details (optional)
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor={`invoiceNumber-${currentIndex}`}
                      className="flex items-center gap-1.5"
                    >
                      Bill / Invoice #
                      {ocrFields[currentIndex]?.includes("invoiceNumber") && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-violet-600">
                          <Sparkles className="h-2.5 w-2.5" />
                          AI
                        </span>
                      )}
                    </Label>
                    <Input
                      id={`invoiceNumber-${currentIndex}`}
                      placeholder="e.g. INV-20240312"
                      value={draft.invoiceNumber}
                      onChange={(e) =>
                        updateDraft(currentIndex, {
                          invoiceNumber: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`notes-${currentIndex}`}>Notes</Label>
                    <Textarea
                      id={`notes-${currentIndex}`}
                      placeholder="Additional details…"
                      value={draft.notes}
                      onChange={(e) =>
                        updateDraft(currentIndex, { notes: e.target.value })
                      }
                      rows={2}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          {/* Bottom navigation */}
          <div className="border-t px-6 py-4 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button
              onClick={
                isLastFile && drafts.length === 1 ? handleSave : handleNext
              }
              disabled={!isDraftValid}
            >
              {isLastFile ? (
                drafts.length === 1 ? (
                  "Save Bill"
                ) : (
                  <>
                    Review All
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </>
                )
              ) : (
                <>
                  Next Bill
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // STEP: Review
  // ──────────────────────────────────────────────────────────────────────────────

  if (step === "review") {
    return (
      <Card>
        <StepIndicator activeStep={1} />
        <CardContent className="p-6 space-y-6">
          <div>
            <h3 className="text-xl font-semibold">
              Review your {drafts.length} bill{drafts.length > 1 ? "s" : ""}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Confirm the details before saving.
            </p>
          </div>

          <div className="space-y-3">
            {drafts.map((d, i) => {
              const collName = d.collectionId
                ? collections.find((c) => c.id === d.collectionId)?.title
                : d.newCollectionTitle || null;

              return (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                >
                  {/* Thumbnail */}
                  <div className="h-12 w-12 rounded overflow-hidden border shrink-0 bg-muted flex items-center justify-center">
                    {isImageFile(d.file) ? (
                      <img
                        src={d.objectUrl}
                        alt=""
                        className="h-12 w-12 object-cover"
                      />
                    ) : (
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {d.vendor || d.file.name.replace(/\.[^.]+$/, "")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {d.amount
                            ? `$${parseFloat(d.amount).toFixed(2)}`
                            : "No amount"}{" "}
                          ·{" "}
                          {d.date
                            ? new Date(
                                d.date + "T00:00:00",
                              ).toLocaleDateString()
                            : "No date"}{" "}
                          · {d.category}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Patient:{" "}
                          {rosterMembers.find(
                            (m) => m.id === (d.patientId ?? rosterSelf?.id),
                          )?.name ?? "Not set"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentIndex(i);
                          setStep("details");
                        }}
                        className="text-xs text-primary hover:underline shrink-0"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      {collName && (
                        <div className="flex items-center gap-1">
                          <FolderHeart className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {collName}
                          </span>
                        </div>
                      )}
                      {HSA_ELIGIBLE_CATEGORIES.includes(d.category) && (
                        <Badge className="text-xs bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-50">
                          HSA Eligible
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setCurrentIndex(drafts.length - 1);
                setStep("details");
              }}
              className="flex-1"
            >
              ← Back to Edit
            </Button>
            <Button onClick={handleSave} className="flex-1">
              Save {drafts.length} Bill{drafts.length > 1 ? "s" : ""}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // STEP: Saving
  // ──────────────────────────────────────────────────────────────────────────────

  if (step === "saving") {
    return (
      <Card>
        <StepIndicator activeStep={2} />
        <CardContent className="p-8 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Saving your bills…</h3>
          <p className="text-sm text-muted-foreground">
            {savingIndex > 0
              ? `Saving bill ${savingIndex} of ${drafts.length}…`
              : "Preparing…"}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // STEP: Complete
  // ──────────────────────────────────────────────────────────────────────────────

  if (step === "complete") {
    return (
      <Card>
        <StepIndicator activeStep={2} />
        <CardContent className="p-8 text-center space-y-6">
          <div>
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-1">
              {savedInvoices.length} bill{savedInvoices.length > 1 ? "s" : ""}{" "}
              saved!
            </h3>
            <p className="text-sm text-muted-foreground">
              Your bills are now being tracked in Reclaim.
            </p>
          </div>

          {savedInvoices.length > 0 && (
            <div className="space-y-2 text-left">
              {savedInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div>
                    <p className="font-medium text-sm">{inv.vendor}</p>
                    <p className="text-xs text-muted-foreground">
                      ${parseFloat(inv.amount).toFixed(2)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => (window.location.href = `/bills/${inv.id}`)}
                  >
                    View →
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={handleReset} variant="outline" className="flex-1">
              <Plus className="h-4 w-4 mr-2" />
              Add Another Bill
            </Button>
            <Button
              onClick={() => (window.location.href = "/bills")}
              className="flex-1"
            >
              I'm Done
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // STEP: Error
  // ──────────────────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardContent className="p-8 text-center">
        <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />
        <h3 className="text-xl font-semibold mb-2">Upload Failed</h3>
        <p className="text-muted-foreground mb-6">{errorMessage}</p>
        <div className="flex gap-3 justify-center">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={handleReset}>Try Again</Button>
        </div>
      </CardContent>
    </Card>
  );
}
