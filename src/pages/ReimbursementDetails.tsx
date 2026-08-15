import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReclaimLogo } from "@/components/ReclaimLogo";
import { Download, FileText } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import { generateReimbursementPDF } from "@/lib/pdfGenerator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReceiptGallery } from "@/components/expense/ReceiptGallery";
import { logError } from "@/utils/errorHandler";

const ReimbursementDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [allReceipts, setAllReceipts] = useState<any[]>([]);

  useEffect(() => {
    fetchRequestDetails();
  }, [id]);

  const fetchRequestDetails = async () => {
    try {
      const { data: requestData, error: requestError } = await supabase
        .from("reimbursement_requests")
        .select("*")
        .eq("id", id)
        .single();

      if (requestError) throw requestError;
      setRequest(requestData);

      const { data: itemsData, error: itemsError } = await supabase
        .from("reimbursement_items")
        .select(
          `
          *,
          expense:expenses(*)
        `,
        )
        .eq("reimbursement_request_id", id);

      if (itemsError) throw itemsError;
      const expensesList = itemsData?.map((item: any) => item.expense) || [];
      setExpenses(expensesList);

      // Fetch all receipts for these expenses
      const expenseIds = expensesList.map((e: any) => e.id);
      if (expenseIds.length > 0) {
        const { data: receiptsData } = await supabase
          .from("receipts")
          .select("*")
          .in("invoice_id", expenseIds)
          .order("display_order");

        if (receiptsData) {
          setAllReceipts(receiptsData);
        }
      }
    } catch (error) {
      logError("Failed to fetch request details", error);
      toast.error("Failed to load reimbursement details");
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ["Date", "Vendor", "Category", "Amount", "Notes"];
    const rows = expenses.map((exp) => [
      exp.date,
      exp.vendor,
      exp.category,
      exp.amount,
      exp.notes || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hsa-reimbursement-${request?.id}.csv`;
    a.click();
    toast.success("CSV exported successfully");
  };

  const handleGeneratePDF = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch HSA accounts for grouping
      const { data: hsaAccounts } = await supabase
        .from("hsa_accounts")
        .select("id, account_name")
        .eq("user_id", user.id);

      toast.info("Generating PDF...");
      const pdfBlob = await generateReimbursementPDF({
        expenses,
        totalAmount: Number(request.total_amount),
        notes: request.notes,
        hsaProvider: request.hsa_provider,
        userName: user.user_metadata?.full_name || user.email || "User",
        userEmail: user.email || "",
        hsaAccounts: hsaAccounts || undefined,
      });

      const url = window.URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hsa-reimbursement-${request.id}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);

      toast.success("PDF generated successfully");
    } catch (error) {
      logError("PDF generation failed", error);
      toast.error("Failed to generate PDF");
    }
  };

  const handleStatusUpdate = async (newStatus: string) => {
    const previousStatus = request?.status;
    try {
      const { error } = await supabase
        .from("reimbursement_requests")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) throw error;
      setRequest({ ...request, status: newStatus });
      toast.success(`Status updated to ${newStatus}`);

      // Send notification email on meaningful status transitions (not same-status no-ops)
      if (previousStatus !== newStatus) {
        supabase.functions
          .invoke("send-notification", {
            body: {
              type: "reimbursement_update",
              request_id: id,
              new_status: newStatus,
              total_amount: Number(request?.total_amount ?? 0),
              hsa_provider: request?.hsa_provider ?? undefined,
            },
          })
          .catch((err) =>
            logError("Failed to send reimbursement notification", err),
          );
      }
    } catch (error) {
      logError("Failed to update status", error);
      toast.error("Failed to update status");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">
            Reimbursement request not found
          </p>
          <Button onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="hover:opacity-80 transition-opacity"
          >
            <ReclaimLogo size="sm" showTagline />
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <Breadcrumb className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                onClick={() => navigate("/reimbursement-requests")}
                className="cursor-pointer"
              >
                HSA Claims
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Request Details</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">
            Reimbursement Request Details
          </h1>
          <p className="text-muted-foreground">
            View and manage your HSA reimbursement submission
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Total Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${Number(request.total_amount).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                {expenses.length}{" "}
                {expenses.length === 1 ? "expense" : "expenses"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                HSA Provider
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {request.hsa_provider || "Not specified"}
              </div>
              <p className="text-xs text-muted-foreground">
                Submitted{" "}
                {request.submitted_at
                  ? new Date(request.submitted_at).toLocaleDateString()
                  : "Not yet"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={request.status} onValueChange={handleStatusUpdate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-2">
                Created {new Date(request.created_at).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Export & Actions</CardTitle>
                <CardDescription>
                  Download your reimbursement documentation
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={handleGeneratePDF}>
                <FileText className="mr-2 h-4 w-4" />
                Generate PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        {request.notes && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{request.notes}</p>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Attached Expenses</CardTitle>
            <CardDescription>
              Expenses included in this reimbursement request
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {expenses.map((expense) => (
                <div
                  key={expense.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{expense.vendor}</p>
                      {expense.is_hsa_eligible && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          HSA
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {expense.category} •{" "}
                      {new Date(expense.date).toLocaleDateString()}
                    </p>
                    {expense.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {expense.notes}
                      </p>
                    )}
                  </div>
                  <p className="font-semibold">
                    ${Number(expense.amount).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {allReceipts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Supporting Documents</CardTitle>
              <CardDescription>
                All receipts and documentation for this reimbursement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReceiptGallery
                expenseId={id!}
                receipts={allReceipts}
                onReceiptDeleted={fetchRequestDetails}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default ReimbursementDetails;
