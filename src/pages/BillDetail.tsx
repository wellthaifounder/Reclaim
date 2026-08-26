import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { SubstantiationPanel } from "@/components/expense/SubstantiationPanel";
import { logError } from "@/utils/errorHandler";
import { ReceiptGallery } from "@/components/expense/ReceiptGallery";
import { MultiFileUpload } from "@/components/expense/MultiFileUpload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useHSA } from "@/contexts/HSAContext";
import { HSAUpgradePrompt } from "@/components/HSAUpgradePrompt";

interface UploadedFile {
  file: File;
  documentType: string;
  description?: string;
}

const HSA_ELIGIBLE_CATEGORIES = [
  "Doctor Visit",
  "Prescription",
  "Dental",
  "Vision",
  "Medical Equipment",
  "Lab Tests",
  "Hospital",
  "Physical Therapy",
  "Mental Health",
  "Other Medical",
];

export default function BillDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasHSA } = useHSA();
  const isNewBill = id === "new";
  const [activeTab, setActiveTab] = useState("overview");
  const [newFiles, setNewFiles] = useState<UploadedFile[]>([]);
  const [isAnalyzing] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    vendor: "",
    totalAmount: "",
    category: "",
    notes: "",
    invoiceNumber: "",
    isHsaEligible: false,
  });

  // Fetch bill data
  const {
    data: bill,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["bill", id],
    queryFn: async () => {
      if (isNewBill || !id) return null;

      // Get current user for ownership verification
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id) // Explicit ownership check
        .single();

      if (error) throw error;
      if (!data) throw new Error("Bill not found or access denied");
      return data;
    },
    enabled: !isNewBill && !!id,
  });

  // Fetch receipts/documents
  const { data: receipts, refetch: refetchReceipts } = useQuery({
    queryKey: ["receipts", id],
    queryFn: async () => {
      if (isNewBill || !id) return [];
      const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .eq("invoice_id", id)
        .order("display_order");

      if (error) throw error;
      return data || [];
    },
    enabled: !isNewBill && !!id,
  });

  // Bill review feature archived - removed error fetching

  // A provider-directory lookup used to run here. It was already inert -- the
  // query result was never bound to anything, so it fetched a row on every
  // bill view and threw it away. Removed 2026-08-20 with the provider
  // directory tables it read from.

  // Bill review feature archived - removed AI analysis function

  // Load bill data into form when editing
  useEffect(() => {
    if (bill && !isNewBill) {
      setFormData({
        date: bill.date,
        vendor: bill.vendor,
        totalAmount:
          bill.total_amount?.toString() || bill.amount?.toString() || "",
        category: bill.category,
        notes: bill.notes || "",
        invoiceNumber: bill.invoice_number || "",
        isHsaEligible: bill.eligibility_state === "eligible",
      });
    }
  }, [bill, isNewBill]);

  // Auto-set HSA eligibility based on category (for new bills)
  useEffect(() => {
    if (isNewBill && formData.category) {
      const isEligible = HSA_ELIGIBLE_CATEGORIES.includes(formData.category);
      setFormData((prev) => ({ ...prev, isHsaEligible: isEligible }));
    }
  }, [formData.category, isNewBill]);

  const handleSaveBill = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const amount = parseFloat(formData.totalAmount);
      if (isNaN(amount) || amount <= 0) {
        toast.error("Please enter a valid amount");
        return;
      }

      const billData = {
        user_id: user.id,
        date: formData.date,
        vendor: formData.vendor,
        amount: amount,
        total_amount: amount,
        category: formData.category,
        notes: formData.notes || null,
        invoice_number: formData.invoiceNumber || null,
        // Workstream B: is_hsa_eligible is derived from eligibility_state.
        // Ticking the box on this form IS an explicit user determination, so
        // it earns 'eligible'; unticking returns to 'unknown' rather than
        // asserting ineligibility, which is a stronger and different claim.
        eligibility_state: formData.isHsaEligible
          ? ("eligible" as const)
          : ("unknown" as const),
      };

      let billId = id;

      if (isNewBill) {
        const { data, error } = await supabase
          .from("invoices")
          .insert(billData)
          .select()
          .single();

        if (error) throw error;
        billId = data.id;

        toast.success("Bill created successfully!");
        navigate(`/bills/${billId}`);
      } else {
        if (!id) throw new Error("Missing bill id");
        const { error } = await supabase
          .from("invoices")
          .update(billData)
          .eq("id", id);

        if (error) throw error;
        toast.success("Bill updated successfully!");
        refetch();
      }

      // Upload new files if any
      if (newFiles.length > 0 && billId) {
        for (let i = 0; i < newFiles.length; i++) {
          const fileData = newFiles[i];
          const fileExt = fileData.file.name.split(".").pop();
          const timestamp = Date.now();
          const filePath = `${user.id}/${billId}/${fileData.documentType}_${timestamp}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from("receipts")
            .upload(filePath, fileData.file);

          if (uploadError) throw uploadError;

          // Nothing consumes the inserted row — the only reader was the
          // archived bill-review analysis — so skip the select round-trip.
          const { error: receiptError } = await supabase
            .from("receipts")
            .insert({
              user_id: user.id,
              invoice_id: billId,
              file_path: filePath,
              file_type: fileData.file.type,
              document_type: fileData.documentType,
              description: fileData.description || null,
              display_order: i,
            });

          if (receiptError) throw receiptError;
        }

        setNewFiles([]);
        refetchReceipts();

        // Bill review feature archived — the AI analysis trigger and the
        // bill/EOB lookup that fed it were removed with it.
      }
    } catch (error) {
      logError("Error saving bill", error);
      toast.error("Failed to save bill");
    }
  };

  // Bill review feature archived - removed handleStartDispute and handleMarkCorrect

  if (isLoading && !isNewBill) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AuthenticatedLayout>
    );
  }

  // Bill review feature archived - removed review and errorCount

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-6xl">
        <Breadcrumb className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                onClick={() => navigate("/bills")}
                className="cursor-pointer"
              >
                Bills
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate max-w-[260px]">
                {isNewBill ? "Add New Bill" : bill?.vendor || "Bill Details"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            {isNewBill ? "Add New Bill" : "Bill Details"}
          </h1>
          <p className="text-muted-foreground">
            {isNewBill
              ? "Upload medical bills and documentation to start tracking this expense"
              : "View and manage bill information, payments, and documentation"}
          </p>
        </div>

        <div className="max-w-5xl mx-auto">
          {/* Workstream D5. The substantiation step, above the bill record
              itself: the gates inside it can be a hard no, and finding that
              out below the fold is finding it out too late. */}
          {!isNewBill && bill?.id && (
            <div className="mb-4">
              <SubstantiationPanel
                invoiceId={bill.id}
                amountPaid={Number(bill.amount_paid ?? bill.amount ?? 0)}
                reimbursableAmount={
                  bill.reimbursable_amount === null ||
                  bill.reimbursable_amount === undefined
                    ? null
                    : Number(bill.reimbursable_amount)
                }
                serviceDate={bill.service_date ?? null}
                serviceDateEnd={bill.service_date_end ?? null}
                patientId={bill.patient_id ?? null}
                mileage={
                  bill.mileage_miles == null
                    ? null
                    : {
                        miles: Number(bill.mileage_miles),
                        rate: Number(bill.mileage_rate ?? 0),
                        trips:
                          bill.mileage_trips == null
                            ? null
                            : Number(bill.mileage_trips),
                        parkingAndTolls:
                          bill.mileage_parking_tolls == null
                            ? null
                            : Number(bill.mileage_parking_tolls),
                      }
                }
                onSaved={refetch}
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl">
                    {isNewBill
                      ? "Add New Bill"
                      : bill?.vendor || "Bill Details"}
                  </CardTitle>
                  <CardDescription>
                    {isNewBill
                      ? "Track your medical bill and manage payments"
                      : bill?.invoice_number
                        ? `Bill #${bill.invoice_number}`
                        : "No bill number"}
                  </CardDescription>
                </div>
                {/* Bill review feature archived - removed review badge */}
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                {/* Payments tab removed 2026-08-21 — see the note where the
                    payment history used to render, below the Documents tab. */}
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="overview">
                    <FileText className="h-4 w-4 mr-2" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="documents">
                    <Upload className="h-4 w-4 mr-2" />
                    Documents
                  </TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-6 mt-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="date">Bill Date</Label>
                      <Input
                        id="date"
                        type="date"
                        value={formData.date}
                        onChange={(e) =>
                          setFormData({ ...formData, date: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invoiceNumber">
                        Bill Number (Optional)
                      </Label>
                      <Input
                        id="invoiceNumber"
                        placeholder="e.g., INV-12345"
                        value={formData.invoiceNumber}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            invoiceNumber: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vendor">Provider/Vendor</Label>
                    <Input
                      id="vendor"
                      placeholder="e.g., City Hospital"
                      value={formData.vendor}
                      onChange={(e) =>
                        setFormData({ ...formData, vendor: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) =>
                          setFormData({ ...formData, category: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {HSA_ELIGIBLE_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="totalAmount">Total Amount</Label>
                      <Input
                        id="totalAmount"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.totalAmount}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            totalAmount: e.target.value,
                          })
                        }
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="hsaEligible"
                      checked={formData.isHsaEligible}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, isHsaEligible: checked })
                      }
                    />
                    <Label htmlFor="hsaEligible">HSA Eligible</Label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      placeholder="Additional notes..."
                      value={formData.notes}
                      onChange={(e) =>
                        setFormData({ ...formData, notes: e.target.value })
                      }
                      rows={4}
                    />
                  </div>

                  {/* Show HSA upgrade prompt for non-HSA users when expense is HSA-eligible */}
                  {!hasHSA &&
                    formData.isHsaEligible &&
                    formData.totalAmount && (
                      <HSAUpgradePrompt
                        expenseAmount={parseFloat(formData.totalAmount)}
                        context="bill-detail"
                        variant="compact"
                      />
                    )}

                  {/* The Total Billed / Paid via HSA / Paid Other / Unpaid
                   * strip was removed with the payment table it summed
                   * (2026-08-21). Without those rows every figure but the
                   * first was zero, so the panel would have shown every
                   * expense as fully unpaid in red -- including the ones the
                   * user had already paid out of pocket, which is the entire
                   * population of this app. A wrong number in red is worse
                   * than no number. What the user actually needs to know here
                   * -- how much of this is claimable -- is on the
                   * substantiation panel, computed from the expense itself. */}

                  <div className="flex gap-3">
                    <Button onClick={handleSaveBill}>
                      {isNewBill ? "Create Bill" : "Save Changes"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => navigate("/bills")}
                    >
                      Cancel
                    </Button>
                  </div>
                </TabsContent>

                {/* Documents Tab */}
                <TabsContent value="documents" className="space-y-6 mt-6">
                  {isAnalyzing && (
                    <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                        <div>
                          <p className="font-medium">AI Analysis in Progress</p>
                          <p className="text-sm text-muted-foreground">
                            Analyzing your bill for potential errors and
                            overcharges. This may take up to 30 seconds.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isNewBill && receipts && receipts.length > 0 && (
                    <div className="space-y-2">
                      <Label>Existing Documents</Label>
                      <ReceiptGallery
                        expenseId={id!}
                        receipts={receipts}
                        onReceiptDeleted={refetchReceipts}
                        onReceiptUpdated={refetchReceipts}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Upload New Documents</Label>
                    <p className="text-sm text-muted-foreground">
                      Upload your medical bill, EOB (Explanation of Benefits),
                      or any supporting documentation.
                    </p>
                    <MultiFileUpload
                      onFilesChange={setNewFiles}
                      disabled={isAnalyzing}
                    />
                    {newFiles.length > 0 && (
                      <Button
                        onClick={handleSaveBill}
                        className="mt-4"
                        disabled={isAnalyzing}
                      >
                        Upload {newFiles.length} Document
                        {newFiles.length !== 1 ? "s" : ""}
                      </Button>
                    )}
                  </div>
                </TabsContent>

                {/* Bill review feature archived - removed AI Review tab */}

                {/* Payment history removed 2026-08-21.
                 *
                 * It listed rows from a second payment table and offered
                 * "Link Transaction" to add more by hand. Both are gone. An
                 * expense in Reclaim comes FROM a payment the bank already
                 * recorded -- the transaction it was captured from is the
                 * payment, and there is exactly one. Keeping a separate list
                 * of payments against the same expense meant the app held two
                 * answers to "how much has been paid" and no rule for which
                 * one won.
                 *
                 * Part-payment over time is the real feature underneath this,
                 * and the spec defers it to v1.1 on purpose. Until then the
                 * amount is editable downward on the expense itself, which
                 * covers the common case of an insurance refund landing
                 * later. */}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
