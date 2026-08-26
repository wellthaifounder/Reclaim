import { Check, AlertCircle, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Receipt {
  document_type: string | null;
}

interface DocumentChecklistProps {
  category: string;
  amount: number;
  receipts: Receipt[];
  hasPaymentPlan?: boolean;
}

interface RequiredDocument {
  type: string;
  label: string;
  required: boolean;
  reason: string;
}

export function DocumentChecklist({
  category,
  amount,
  receipts,
  hasPaymentPlan,
}: DocumentChecklistProps) {
  const getRequiredDocuments = (): RequiredDocument[] => {
    const docs: RequiredDocument[] = [];

    // Base requirement - always need proof
    if (amount >= 250) {
      docs.push({
        type: "invoice",
        label: "Medical Bill or Itemized Statement",
        required: true,
        reason: "IRS requires itemized documentation for expenses over $250",
      });
    }

    // Medical categories
    if (["Medical", "Dental", "Vision", "Hospital"].includes(category)) {
      if (amount >= 500) {
        docs.push({
          type: "eob",
          label: "Explanation of Benefits (EOB)",
          required: false,
          reason: "Recommended for insurance coordination and audit protection",
        });
      }
    }

    // Hospital-specific
    if (category === "Hospital" || amount >= 1000) {
      docs.push({
        type: "invoice",
        label: "Itemized Hospital Bill",
        required: true,
        reason: "Must show detailed breakdown of charges",
      });
    }

    // Prescription
    if (category === "Prescription") {
      docs.push({
        type: "prescription_label",
        label: "Prescription Label or Rx Number",
        required: false,
        reason: "Helpful for proving medical necessity",
      });
    }

    // Payment plan
    if (hasPaymentPlan) {
      docs.push({
        type: "payment_receipt",
        label: "Payment Receipts",
        required: true,
        reason: "Must document each installment payment made",
      });
    }

    // Payment proof for larger amounts
    if (amount >= 100 && !hasPaymentPlan) {
      docs.push({
        type: "payment_receipt",
        label: "Proof of Payment",
        required: false,
        reason: "Credit card statement or payment confirmation",
      });
    }

    return docs;
  };

  const requiredDocs = getRequiredDocuments();

  if (requiredDocs.length === 0) {
    return null;
  }

  const hasDocument = (type: string) => {
    return receipts.some((r) => r.document_type === type);
  };

  const completedRequired = requiredDocs.filter(
    (doc) => doc.required && hasDocument(doc.type),
  ).length;
  const totalRequired = requiredDocs.filter((doc) => doc.required).length;
  const completionRate =
    totalRequired > 0
      ? Math.round((completedRequired / totalRequired) * 100)
      : 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">IRS Audit Documentation</CardTitle>
            <CardDescription>
              Required documents for this expense
            </CardDescription>
          </div>
          <Badge variant={completionRate === 100 ? "default" : "secondary"}>
            {completionRate}% Complete
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {requiredDocs.map((doc) => {
          const hasDoc = hasDocument(doc.type);
          return (
            <div
              key={doc.type}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                hasDoc
                  ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                  : "bg-card"
              }`}
            >
              <div className="mt-0.5">
                {hasDoc ? (
                  <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : doc.required ? (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <Info className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{doc.label}</p>
                  {doc.required && !hasDoc && (
                    <Badge variant="destructive" className="text-xs">
                      Required
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {doc.reason}
                </p>
              </div>
            </div>
          );
        })}

        {hasPaymentPlan && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Payment Plan Detected:</strong> Upload the original bill
              now, then add payment receipts as you make each installment. You
              can only reimburse the amounts you've actually paid.
            </AlertDescription>
          </Alert>
        )}

        {completionRate === 100 && totalRequired > 0 && (
          <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
            <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              <strong>Audit Ready!</strong> You have all required documentation
              for IRS compliance.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
