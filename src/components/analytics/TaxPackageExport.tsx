import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/utils/errorHandler";
import { generateTaxPackageReport } from "@/lib/taxReportGenerator";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const TaxPackageExport = () => {
  const [selectedYear, setSelectedYear] = useState<string>(
    new Date().getFullYear().toString(),
  );
  const [isGenerating, setIsGenerating] = useState(false);

  // Generate list of available years (current year and 5 years back)
  const currentYear = new Date().getFullYear();
  const availableYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const handleExport = async () => {
    setIsGenerating(true);
    try {
      // Fetch invoices for the selected tax year
      const { data: invoices, error: invoicesError } = await supabase
        .from("invoices")
        .select("*")
        .gte("date", `${selectedYear}-01-01`)
        .lte("date", `${selectedYear}-12-31`)
        .eq("eligibility_state", "eligible")
        .order("date", { ascending: true });

      if (invoicesError) throw invoicesError;

      if (!invoices || invoices.length === 0) {
        toast.error(`No HSA-eligible expenses found for ${selectedYear}`);
        setIsGenerating(false);
        return;
      }

      // Fetch receipts for these invoices. Attachment lives in
      // receipt_invoices now, not receipts.invoice_id -- a document shared
      // with another expense still needs to appear in this export. Joined
      // through the link table rather than filtered on it, so a document
      // attached to two of this year's invoices isn't listed twice.
      const invoiceIds = invoices.map((inv) => inv.id);
      const { data: linkedReceipts, error: receiptsError } = await supabase
        .from("receipts")
        .select("*, receipt_invoices!inner(invoice_id)")
        .in("receipt_invoices.invoice_id", invoiceIds);

      if (receiptsError) throw receiptsError;

      const receipts = Array.from(
        new Map((linkedReceipts ?? []).map((r) => [r.id, r])).values(),
      );

      toast.loading("Generating your tax package...");

      // Generate the PDF
      const pdfBlob = await generateTaxPackageReport({
        invoices,
        receipts: receipts || [],
        taxYear: parseInt(selectedYear),
      });

      // Create download link
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Reclaim_Tax_Package_${selectedYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.dismiss();
      toast.success(`Tax package for ${selectedYear} downloaded successfully!`);
    } catch (error) {
      logError("Error generating tax package", error);
      toast.dismiss();
      toast.error("Failed to generate tax package. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-lg">IRS Tax Package</CardTitle>
            <CardDescription className="mt-1.5">
              Generate an IRS-ready report with all HSA-eligible expenses and
              Form 8889 helper worksheet
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Tax Year</label>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-background/50 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium">Package includes:</p>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span>Form 8889 helper worksheet with calculated totals</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span>Itemized list of all HSA-eligible expenses</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span>Category breakdown and summary</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span>Receipt documentation index</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span>IRS compliance information</span>
            </li>
          </ul>
        </div>

        <Button
          onClick={handleExport}
          disabled={isGenerating}
          className="w-full"
          size="lg"
        >
          <Download className="h-4 w-4 mr-2" />
          {isGenerating
            ? "Generating..."
            : `Download ${selectedYear} Tax Package`}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Premium feature • Free for Plus & Premium subscribers
        </p>
      </CardContent>
    </Card>
  );
};
