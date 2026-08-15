import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, TrendingUp } from "lucide-react";

interface ProcedureInsight {
  id: string;
  cpt_code: string;
  procedure_name: string;
  procedure_category?: string | null;
  average_patient_cost: number;
  median_patient_cost?: number | null;
  typical_insurance_payment?: number | null;
  times_performed: number;
  fair_price_indicator?: string | null;
}

interface ProcedureCostInsightsProps {
  insights: ProcedureInsight[];
  loading?: boolean;
}

export function ProcedureCostInsights({
  insights,
  loading,
}: ProcedureCostInsightsProps) {
  const getFairPriceBadge = (indicator?: string) => {
    switch (indicator) {
      case "below_average":
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            Below Average
          </Badge>
        );
      case "average":
        return (
          <Badge variant="secondary">
            <CheckCircle className="h-3 w-3 mr-1" />
            Fair
          </Badge>
        );
      case "above_average":
        return (
          <Badge
            variant="outline"
            className="border-yellow-600 text-yellow-600"
          >
            <TrendingUp className="h-3 w-3 mr-1" />
            Above Average
          </Badge>
        );
      case "significantly_high":
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            High
          </Badge>
        );
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Common Procedures & Costs</CardTitle>
          <CardDescription>Loading procedure data...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!insights || insights.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Common Procedures & Costs</CardTitle>
          <CardDescription>No procedure data available yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Procedure cost insights will appear here once billing data is
            analyzed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Common Procedures & Costs</CardTitle>
        <CardDescription>
          Average out-of-pocket costs for procedures performed by this provider
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Procedure</TableHead>
                <TableHead>CPT Code</TableHead>
                <TableHead className="text-right">Avg Cost</TableHead>
                <TableHead className="text-right">Insurance</TableHead>
                <TableHead className="text-center">Price Rating</TableHead>
                <TableHead className="text-center">Volume</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {insights.map((insight) => (
                <TableRow key={insight.id}>
                  <TableCell className="font-medium">
                    {insight.procedure_name}
                    {insight.procedure_category && (
                      <div className="text-xs text-muted-foreground">
                        {insight.procedure_category}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {insight.cpt_code}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    ${insight.average_patient_cost.toFixed(2)}
                    {insight.median_patient_cost && (
                      <div className="text-xs text-muted-foreground">
                        median: ${insight.median_patient_cost.toFixed(2)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {insight.typical_insurance_payment
                      ? `$${insight.typical_insurance_payment.toFixed(2)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {getFairPriceBadge(insight.fair_price_indicator)}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {insight.times_performed} bill
                    {insight.times_performed !== 1 ? "s" : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          * Costs shown are average out-of-pocket amounts based on anonymized
          patient bills. Your actual cost may vary based on insurance coverage
          and specific treatment.
        </p>
      </CardContent>
    </Card>
  );
}
