import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { MultiFileUpload } from "@/components/expense/MultiFileUpload";
import { Badge } from "@/components/ui/badge";
import { HSAAccountSelector } from "@/components/hsa/HSAAccountSelector";
import { useHSAAccounts } from "@/hooks/useHSAAccounts";
import { logError } from "@/utils/errorHandler";

const paymentSchema = z.object({
  paymentDate: z.string().min(1, "Payment date is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  paymentSource: z.enum(["hsa_direct", "out_of_pocket"]),
  notes: z.string().max(500).optional(),
});

const PaymentEntry = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedInvoiceId = searchParams.get("invoice");

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [newFiles, setNewFiles] = useState<any[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<string>("");
  const [selectedHSAAccount, setSelectedHSAAccount] = useState<string>("");
  useHSAAccounts();

  const [formData, setFormData] = useState({
    paymentDate: new Date().toISOString().split("T")[0],
    amount: "",
    paymentSource: "out_of_pocket" as "hsa_direct" | "out_of_pocket",
    paymentMethodId: "",
    notes: "",
  });

  useEffect(() => {
    fetchInvoices();
    fetchPaymentMethods();
    if (preselectedInvoiceId) {
      setSelectedInvoice(preselectedInvoiceId);
    }
  }, [preselectedInvoiceId]);

  useEffect(() => {
    if (selectedInvoice) {
      fetchPaymentsForInvoice(selectedInvoice);
    }
  }, [selectedInvoice]);

  const fetchInvoices = async () => {
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .order("invoice_date", { ascending: false });

      if (error) throw error;
      setInvoices(data || []);
    } catch (error) {
      logError("Error loading invoices:", error);
      toast.error("Failed to load invoices");
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .order("name");

      if (error) throw error;
      setPaymentMethods(data || []);
    } catch (error) {
      logError("Error loading payment methods:", error);
    }
  };

  const fetchPaymentsForInvoice = async (invoiceId: string) => {
    try {
      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("payment_date", { ascending: false });

      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      logError("Error loading payments:", error);
    }
  };

  const selectedInvoiceData = invoices.find(
    (inv) => inv.id === selectedInvoice,
  );
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const remainingBalance = selectedInvoiceData
    ? Number(selectedInvoiceData.total_amount || selectedInvoiceData.amount) -
      totalPaid
    : 0;
  const hsaPaid = payments
    .filter((p) => p.payment_source === "hsa_direct")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const otherPaid = payments
    .filter((p) => p.payment_source === "out_of_pocket")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedInvoice) {
      toast.error("Please select an invoice");
      return;
    }

    setLoading(true);

    try {
      const validatedData = paymentSchema.parse({
        ...formData,
        amount: parseFloat(formData.amount),
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const dateObj = new Date(validatedData.paymentDate + "T00:00:00");
      const formattedDate = dateObj.toISOString().split("T")[0];

      const { data: payment, error: paymentError } = await supabase
        .from("payment_transactions")
        .insert({
          invoice_id: selectedInvoice,
          user_id: user.id,
          payment_date: formattedDate,
          amount: validatedData.amount,
          payment_source: validatedData.paymentSource,
          payment_method_id: formData.paymentMethodId || null,
          notes: validatedData.notes || null,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      if (newFiles.length > 0 && payment) {
        for (let i = 0; i < newFiles.length; i++) {
          const fileData = newFiles[i];
          const fileExt = fileData.file.name.split(".").pop();
          const timestamp = Date.now();
          const filePath = `${user.id}/${payment.id}/payment_${timestamp}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from("receipts")
            .upload(filePath, fileData.file);

          if (uploadError) throw uploadError;

          const { error: receiptError } = await supabase
            .from("receipts")
            .insert({
              user_id: user.id,
              payment_transaction_id: payment.id,
              file_path: filePath,
              file_type: fileData.file.type,
              document_type: "payment_receipt",
              description: fileData.description || null,
              display_order: i,
            });

          if (receiptError) throw receiptError;
        }
      }

      setSuccess(true);
      toast.success("Payment recorded successfully!");

      setTimeout(() => {
        setSuccess(false);
        navigate("/expenses");
      }, 2000);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else {
        toast.error("Failed to record payment");
        logError("Error recording payment:", error);
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md mx-auto text-center p-8">
          <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
          <CardTitle className="mb-2">Payment Recorded!</CardTitle>
          <CardDescription>Redirecting to expenses...</CardDescription>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <button
            onClick={() => navigate("/dashboard")}
            className="hover:text-foreground"
          >
            Dashboard
          </button>
          <span>/</span>
          <button
            onClick={() => navigate("/bills")}
            className="hover:text-foreground"
          >
            Bills
          </button>
          <span>/</span>
          <span className="text-foreground">Record Payment</span>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Record Payment</CardTitle>
            <CardDescription>
              Log a payment made toward a medical bill
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="invoice">Select Bill</Label>
                <Select
                  value={selectedInvoice}
                  onValueChange={setSelectedInvoice}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a bill" />
                  </SelectTrigger>
                  <SelectContent>
                    {invoices.map((invoice) => (
                      <SelectItem key={invoice.id} value={invoice.id}>
                        {invoice.vendor} - $
                        {Number(invoice.total_amount || invoice.amount).toFixed(
                          2,
                        )}{" "}
                        (
                        {new Date(
                          invoice.invoice_date || invoice.date,
                        ).toLocaleDateString()}
                        )
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedInvoice && selectedInvoiceData && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Bill Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Total Billed:
                      </span>
                      <span className="font-semibold">
                        $
                        {Number(
                          selectedInvoiceData.total_amount ||
                            selectedInvoiceData.amount,
                        ).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Paid via HSA:
                      </span>
                      <Badge variant="outline" className="bg-primary/10">
                        ${hsaPaid.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Paid via Other:
                      </span>
                      <Badge variant="outline" className="bg-yellow-500/10">
                        ${otherPaid.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t">
                      <span className="text-muted-foreground font-medium">
                        Remaining Balance:
                      </span>
                      <Badge
                        variant={
                          remainingBalance > 0 ? "destructive" : "outline"
                        }
                        className="bg-red-500/10"
                      >
                        ${remainingBalance.toFixed(2)}
                      </Badge>
                    </div>
                    {selectedInvoiceData.is_hsa_eligible && (
                      <div className="text-xs text-muted-foreground pt-2 border-t">
                        💡 HSA Eligible: Remaining $
                        {remainingBalance.toFixed(2)} + Other payments $
                        {otherPaid.toFixed(2)} = $
                        {(remainingBalance + otherPaid).toFixed(2)} can be
                        reimbursed from HSA
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="paymentDate">Payment Date</Label>
                  <Input
                    id="paymentDate"
                    type="date"
                    value={formData.paymentDate}
                    onChange={(e) =>
                      setFormData({ ...formData, paymentDate: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">Payment Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={(e) =>
                      setFormData({ ...formData, amount: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="paymentSource">Payment Source</Label>
                <Select
                  value={formData.paymentSource}
                  onValueChange={(value: "hsa_direct" | "out_of_pocket") =>
                    setFormData({ ...formData, paymentSource: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hsa_direct">
                      HSA Direct Payment
                    </SelectItem>
                    <SelectItem value="out_of_pocket">
                      Out-of-Pocket (Credit/Debit)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.paymentSource === "hsa_direct" &&
                selectedInvoiceData && (
                  <div className="space-y-2">
                    <Label>HSA Account</Label>
                    <HSAAccountSelector
                      value={selectedHSAAccount}
                      onValueChange={setSelectedHSAAccount}
                      filterByDate={selectedInvoiceData.date}
                    />
                    {!selectedHSAAccount && (
                      <p className="text-sm text-destructive">
                        Please select an HSA account
                      </p>
                    )}
                  </div>
                )}

              {formData.paymentSource === "out_of_pocket" && (
                <div className="space-y-2">
                  <Label htmlFor="paymentMethod">
                    Payment Method (Optional)
                  </Label>
                  <Select
                    value={formData.paymentMethodId}
                    onValueChange={(value) =>
                      setFormData({ ...formData, paymentMethodId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {paymentMethods.map((method) => (
                        <SelectItem key={method.id} value={method.id}>
                          {method.name}{" "}
                          {method.rewards_rate > 0 &&
                            `(${Number(method.rewards_rate * 100).toFixed(1)}% rewards)`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <MultiFileUpload onFilesChange={setNewFiles} disabled={loading} />

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional details about this payment..."
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  maxLength={500}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !selectedInvoice}
              >
                {loading ? "Recording..." : "Record Payment"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PaymentEntry;
