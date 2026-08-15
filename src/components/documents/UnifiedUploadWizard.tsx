import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";
import {
  Upload,
  FileText,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Sparkles,
  AlertTriangle,
  Plus,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AIExtractionCard } from "@/components/bills/AIExtractionCard";

// Document types with metadata
const DOCUMENT_TYPES = [
  // Bills & Statements
  {
    value: "bill",
    label: "Medical Bill",
    category: "bills",
    triggersAIReview: true,
  },
  {
    value: "itemized_statement",
    label: "Itemized Statement",
    category: "bills",
    triggersAIReview: true,
  },
  {
    value: "eob",
    label: "Explanation of Benefits (EOB)",
    category: "insurance",
    triggersAIReview: true,
  },

  // Payments
  {
    value: "payment_receipt",
    label: "Payment Receipt",
    category: "payments",
    triggersAIReview: false,
  },
  {
    value: "payment_plan_agreement",
    label: "Payment Plan Agreement",
    category: "payments",
    triggersAIReview: false,
  },

  // Insurance
  {
    value: "insurance_card",
    label: "Insurance Card",
    category: "insurance",
    triggersAIReview: false,
  },
  {
    value: "prior_authorization",
    label: "Prior Authorization",
    category: "insurance",
    triggersAIReview: false,
  },
  {
    value: "denial_letter",
    label: "Denial Letter",
    category: "insurance",
    triggersAIReview: false,
  },
  {
    value: "appeal_letter",
    label: "Appeal Letter",
    category: "insurance",
    triggersAIReview: false,
  },

  // Clinical
  {
    value: "doctors_notes",
    label: "Doctor's Notes",
    category: "clinical",
    triggersAIReview: false,
  },
  {
    value: "lab_results",
    label: "Lab Results",
    category: "clinical",
    triggersAIReview: false,
  },
  {
    value: "prescription",
    label: "Prescription",
    category: "clinical",
    triggersAIReview: false,
  },

  // Other
  {
    value: "receipt",
    label: "General Receipt",
    category: "receipts",
    triggersAIReview: false,
  },
  {
    value: "other",
    label: "Other Document",
    category: "other",
    triggersAIReview: false,
  },
];

const ALLOWED_FILE_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface FileWithMetadata {
  file: File;
  id: string;
  documentType: string;
  description: string;
}

interface MedicalEvent {
  id: string;
  title: string;
  created_at: string;
}

type WizardStep = "upload" | "classify" | "link" | "ai-review" | "complete";

interface UnifiedUploadWizardProps {
  onComplete?: () => void;
  initialEventId?: string;
}

export function UnifiedUploadWizard({
  onComplete,
  initialEventId,
}: UnifiedUploadWizardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const eventIdFromUrl = searchParams.get("eventId") || initialEventId;

  const [step, setStep] = useState<WizardStep>("upload");
  const [files, setFiles] = useState<FileWithMetadata[]>([]);
  const [linkOption, setLinkOption] = useState<
    "existing" | "new" | "unattached"
  >(eventIdFromUrl ? "existing" : "unattached");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    eventIdFromUrl || null,
  );
  const [newEventTitle, setNewEventTitle] = useState("");
  const [requestAIReview, setRequestAIReview] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<any>(null);

  // Fetch existing events for linking
  const { data: events } = useQuery({
    queryKey: ["medical-events-list"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("collections")
        .select("id, title, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as MedicalEvent[];
    },
  });

  // Check if any selected file can trigger AI review
  const canTriggerAIReview = files.some((f) => {
    const docType = DOCUMENT_TYPES.find((t) => t.value === f.documentType);
    return docType?.triggersAIReview;
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: FileWithMetadata[] = acceptedFiles
      .filter((file) => file.size <= MAX_FILE_SIZE)
      .map((file) => ({
        file,
        id: Math.random().toString(36).substring(7),
        documentType: "other",
        description: "",
      }));

    if (newFiles.length < acceptedFiles.length) {
      toast.error("Some files were too large (max 10MB)");
    }

    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ALLOWED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
  });

  const removeFile = (id: string) => {
    setFiles(files.filter((f) => f.id !== id));
  };

  const updateFileMetadata = (
    id: string,
    field: keyof FileWithMetadata,
    value: string,
  ) => {
    setFiles(files.map((f) => (f.id === id ? { ...f, [field]: value } : f)));
  };

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      setIsUploading(true);
      let eventId = selectedEventId;

      // Create new event if needed
      if (linkOption === "new" && newEventTitle) {
        const { data: newEvent, error: eventError } = await supabase
          .from("collections")
          .insert({
            user_id: user.id,
            title: newEventTitle,
          })
          .select()
          .single();

        if (eventError) throw eventError;
        eventId = newEvent.id;
      }

      // Upload each file
      const uploadedReceipts: any[] = [];
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(((i + 0.5) / files.length) * 100);

        const fileData = files[i];
        const fileExt = fileData.file.name.split(".").pop();
        const timestamp = Date.now();
        const folder = eventId || "unattached";
        const filePath = `${user.id}/${folder}/${fileData.documentType}_${timestamp}.${fileExt}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("receipts")
          .upload(filePath, fileData.file);

        if (uploadError) throw uploadError;

        // Get document category
        const docType = DOCUMENT_TYPES.find(
          (t) => t.value === fileData.documentType,
        );

        // Create receipt record
        const { data: receipt, error: receiptError } = await supabase
          .from("receipts")
          .insert({
            user_id: user.id,
            file_path: filePath,
            file_type: fileData.file.type,
            document_type: fileData.documentType,
            description: fileData.description || null,
            category: docType?.category || "other",
            collection_id: eventId || null,
          })
          .select()
          .single();

        if (receiptError) throw receiptError;
        uploadedReceipts.push(receipt);

        setUploadProgress(((i + 1) / files.length) * 100);
      }

      // Run AI analysis if requested
      if (requestAIReview && canTriggerAIReview) {
        const billReceipt = uploadedReceipts.find((r) =>
          ["bill", "itemized_statement", "eob"].includes(r.document_type),
        );

        if (billReceipt) {
          // Create invoice for the bill
          const { data: invoice, error: invoiceError } = await supabase
            .from("invoices")
            .insert({
              user_id: user.id,
              vendor: "Pending Analysis",
              amount: 0,
              date: new Date().toISOString().split("T")[0],
              category: "Medical Services",
              collection_id: eventId || null,
            })
            .select()
            .single();

          if (!invoiceError && invoice) {
            // Update receipt to link to invoice
            await supabase
              .from("receipts")
              .update({ invoice_id: invoice.id })
              .eq("id", billReceipt.id);

            // Get public URL and run AI analysis
            const { data: urlData } = supabase.storage
              .from("receipts")
              .getPublicUrl(billReceipt.file_path);

            const { data: analysisData } = await supabase.functions.invoke(
              "analyze-medical-bill",
              {
                body: {
                  receiptId: billReceipt.id,
                  imageUrl: urlData.publicUrl,
                  invoiceId: invoice.id,
                },
              },
            );

            if (analysisData?.success) {
              setAiAnalysisResult(analysisData);

              // Update invoice with extracted data
              if (analysisData.metadata) {
                await supabase
                  .from("invoices")
                  .update({
                    vendor:
                      analysisData.metadata.provider_name?.value ||
                      "Unknown Provider",
                    amount: analysisData.metadata.total_amount?.value || 0,
                    total_amount:
                      analysisData.metadata.total_amount?.value || 0,
                    date:
                      analysisData.metadata.service_date?.value ||
                      new Date().toISOString().split("T")[0],
                    category:
                      analysisData.metadata.category?.value ||
                      "Medical Services",
                  })
                  .eq("id", invoice.id);
              }
            }
          }
        }
      }

      return { eventId, receipts: uploadedReceipts };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medical-events"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      setStep("complete");
      toast.success("Documents uploaded successfully!");
    },
    onError: (error) => {
      toast.error("Failed to upload documents");
      logError("Failed to upload documents", error);
    },
    onSettled: () => {
      setIsUploading(false);
    },
  });

  const handleNext = () => {
    if (step === "upload" && files.length === 0) {
      toast.error("Please add at least one document");
      return;
    }
    if (step === "link" && linkOption === "new" && !newEventTitle.trim()) {
      toast.error("Please enter an event title");
      return;
    }

    const steps: WizardStep[] = [
      "upload",
      "classify",
      "link",
      "ai-review",
      "complete",
    ];
    const currentIndex = steps.indexOf(step);

    // Skip AI review step if not applicable
    if (step === "link" && (!canTriggerAIReview || !requestAIReview)) {
      uploadMutation.mutate();
      return;
    }

    if (step === "ai-review") {
      uploadMutation.mutate();
      return;
    }

    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps: WizardStep[] = ["upload", "classify", "link", "ai-review"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const handleComplete = () => {
    onComplete?.();
    navigate("/documents");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className={cn(step === "upload" && "text-primary font-medium")}>
          1. Upload
        </span>
        <ArrowRight className="h-4 w-4" />
        <span className={cn(step === "classify" && "text-primary font-medium")}>
          2. Classify
        </span>
        <ArrowRight className="h-4 w-4" />
        <span className={cn(step === "link" && "text-primary font-medium")}>
          3. Link
        </span>
        {canTriggerAIReview && requestAIReview && (
          <>
            <ArrowRight className="h-4 w-4" />
            <span
              className={cn(step === "ai-review" && "text-primary font-medium")}
            >
              4. AI Review
            </span>
          </>
        )}
        <ArrowRight className="h-4 w-4" />
        <span className={cn(step === "complete" && "text-primary font-medium")}>
          Done
        </span>
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Documents</CardTitle>
            <CardDescription>
              Drag and drop your medical documents or click to browse
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50",
              )}
            >
              <input {...getInputProps()} />
              <Upload
                className={cn(
                  "h-12 w-12 mx-auto mb-4",
                  isDragActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              <p className="text-lg font-medium mb-1">
                {isDragActive ? "Drop files here" : "Upload documents"}
              </p>
              <p className="text-sm text-muted-foreground">
                PDF, PNG, JPG up to 10MB each
              </p>
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 p-3 border rounded-lg"
                  >
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <span className="flex-1 truncate">{f.file.name}</span>
                    <Badge variant="secondary">
                      {(f.file.size / 1024).toFixed(0)} KB
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(f.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleNext} disabled={files.length === 0}>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Classify */}
      {step === "classify" && (
        <Card>
          <CardHeader>
            <CardTitle>Classify Documents</CardTitle>
            <CardDescription>Select the type for each document</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {files.map((f) => (
              <div key={f.id} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium truncate">{f.file.name}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Document Type</Label>
                    <Select
                      value={f.documentType}
                      onValueChange={(v) =>
                        updateFileMetadata(f.id, "documentType", v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className="flex items-center gap-2">
                              <span>{type.label}</span>
                              {type.triggersAIReview && (
                                <Sparkles className="h-3 w-3 text-primary" />
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Description (Optional)</Label>
                    <Input
                      placeholder="e.g., March payment"
                      value={f.description}
                      onChange={(e) =>
                        updateFileMetadata(f.id, "description", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex justify-between">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleNext}>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Link to Event */}
      {step === "link" && (
        <Card>
          <CardHeader>
            <CardTitle>Link to Medical Event</CardTitle>
            <CardDescription>
              Group this document with related items for easier tracking
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div
                className={cn(
                  "p-4 border rounded-lg cursor-pointer transition-colors",
                  linkOption === "existing" && "border-primary bg-primary/5",
                )}
                onClick={() => setLinkOption("existing")}
              >
                <div className="flex items-center gap-3">
                  <Link2 className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Link to existing event</p>
                    <p className="text-sm text-muted-foreground">
                      Add to an episode of care you've already created
                    </p>
                  </div>
                </div>
                {linkOption === "existing" && events && events.length > 0 && (
                  <div className="mt-3">
                    <Select
                      value={selectedEventId || ""}
                      onValueChange={setSelectedEventId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an event" />
                      </SelectTrigger>
                      <SelectContent>
                        {events.map((event) => (
                          <SelectItem key={event.id} value={event.id}>
                            {event.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div
                className={cn(
                  "p-4 border rounded-lg cursor-pointer transition-colors",
                  linkOption === "new" && "border-primary bg-primary/5",
                )}
                onClick={() => setLinkOption("new")}
              >
                <div className="flex items-center gap-3">
                  <Plus className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Create new event</p>
                    <p className="text-sm text-muted-foreground">
                      Start a new episode of care
                    </p>
                  </div>
                </div>
                {linkOption === "new" && (
                  <div className="mt-3">
                    <Input
                      placeholder="e.g., Shoulder Surgery - Jan 2026"
                      value={newEventTitle}
                      onChange={(e) => setNewEventTitle(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div
                className={cn(
                  "p-4 border rounded-lg cursor-pointer transition-colors",
                  linkOption === "unattached" && "border-primary bg-primary/5",
                )}
                onClick={() => setLinkOption("unattached")}
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Upload without linking</p>
                    <p className="text-sm text-muted-foreground">
                      You can organize it later
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Review Option */}
            {canTriggerAIReview && (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="ai-review"
                    checked={requestAIReview}
                    onCheckedChange={(checked) =>
                      setRequestAIReview(checked as boolean)
                    }
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="ai-review"
                      className="font-medium cursor-pointer flex items-center gap-2"
                    >
                      <Sparkles className="h-4 w-4 text-primary" />
                      Request AI Error Detection
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Our AI will analyze your bill for potential errors and
                      overcharges
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleNext} disabled={isUploading}>
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    Upload
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: AI Review (if applicable) */}
      {step === "ai-review" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Analysis
            </CardTitle>
            <CardDescription>
              Review the information extracted from your document
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isUploading ? (
              <div className="text-center py-8">
                <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                <p className="font-medium mb-2">Analyzing your document...</p>
                <Progress value={uploadProgress} className="max-w-xs mx-auto" />
              </div>
            ) : aiAnalysisResult ? (
              <AIExtractionCard
                metadata={aiAnalysisResult.metadata || {}}
                overallConfidence={aiAnalysisResult.confidenceScore || 0}
                warnings={aiAnalysisResult.warnings}
                isEditable={false}
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
                <p>No analysis results available</p>
              </div>
            )}

            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isUploading}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleNext} disabled={isUploading}>
                {isUploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  "Complete"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Complete */}
      {step === "complete" && (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">Upload Complete!</h3>
            <p className="text-muted-foreground mb-6">
              Your {files.length} document{files.length > 1 ? "s have" : " has"}{" "}
              been uploaded successfully.
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  setFiles([]);
                  setStep("upload");
                }}
              >
                Upload More
              </Button>
              <Button onClick={handleComplete}>Done</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
