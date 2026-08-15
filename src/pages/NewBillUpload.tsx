// Reclaim Phase 5 W1 polish — rebrand of the OCR-driven capture surface.
//
// The page used to read "Upload Medical Bill" / "Back to Bills" — that copy
// predated the Reclaim rebrand and conflated bill (a financial event) with
// receipt (the supporting document). Now the page is framed as the brand's
// kill-shot: scan a receipt and we'll fill in the details + check IRS
// eligibility. The wizard itself is unchanged; only the wrapper copy and
// the "log manually" escape hatch are new.
//
// Substantiation (§7 brand term) deliberately doesn't appear here — that's
// an OUTPUT (the IRS-defensible PDF generated on /substantiation), not an
// input mode. Users add EXPENSES (with or without receipts); the system
// GENERATES substantiation records.

import { useNavigate } from "react-router-dom";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { BillUploadWizard } from "@/components/bills/BillUploadWizard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Keyboard, Mail } from "lucide-react";

export default function NewBillUpload() {
  const navigate = useNavigate();

  const handleComplete = (invoiceId: string) => {
    navigate(`/bills/${invoiceId}`);
  };

  const handleCancel = () => {
    navigate("/expenses");
  };

  return (
    <AuthenticatedLayout hideBottomNav>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate("/expenses")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Expenses
          </Button>
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2">Snap a receipt</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            We'll extract the vendor, amount, and date — and check whether it's
            IRS-eligible for your HSA. Takes about 60 seconds.
          </p>
        </div>

        {/* Escape hatch: receipt-less users go to manual entry. The brief §18
            Phase 2 #8 calls manual entry "a fallback" — surfacing it here keeps
            scanning as the primary path while making the fallback one click
            away. */}
        <div className="mb-6 text-center">
          <button
            type="button"
            onClick={() => navigate("/expenses/new")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Don't have a receipt? Log it manually
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Email-forward capture: receipts can also arrive without opening the
            app. The personal address + controls live in Settings; this is just
            the discovery nudge. */}
        <div className="mb-6 text-center">
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Mail className="h-3.5 w-3.5" />
            Or forward receipts by email — set up your address
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <BillUploadWizard onComplete={handleComplete} onCancel={handleCancel} />
      </div>
    </AuthenticatedLayout>
  );
}
