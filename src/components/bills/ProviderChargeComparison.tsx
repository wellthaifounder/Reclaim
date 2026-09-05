import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ChargeData {
  cpt_code: string;
  procedure_name: string;
  average_charge: number;
  medicare_rate: number;
  variance_from_medicare: number;
  sample_size: number;
}

interface ProviderChargeComparisonProps {
  providerId: string;
  chargeData: ChargeData[];
}

export function ProviderChargeComparison({
  providerId: _providerId,
  chargeData,
}: ProviderChargeComparisonProps) {
  if (!chargeData || chargeData.length === 0) {
    return (
      <Card>
        <CardContent className="pt-12 pb-12 text-center">
          <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            No Charge Data Available
          </h3>
          <p className="text-muted-foreground">
            Charge comparisons will appear here as bills are analyzed
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Procedure Charge Comparison</CardTitle>
        <p className="text-sm text-muted-foreground">
          Compare this provider's charges against Medicare rates
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>CPT Code</TableHead>
              <TableHead className="text-right">Provider Avg</TableHead>
              <TableHead className="text-right">Medicare Rate</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">Sample Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chargeData.map((charge) => {
              const variance = Number(charge.variance_from_medicare);
              const isHigher = variance > 0;
              const isSignificant = Math.abs(variance) > 25;

              return (
                <TableRow key={charge.cpt_code}>
                  <TableCell className="font-medium max-w-[200px]">
                    {charge.procedure_name || "Medical Procedure"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{charge.cpt_code}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={Number(charge.average_charge)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={Number(charge.medicare_rate)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {isHigher ? (
                        <TrendingUp
                          className={`h-4 w-4 ${isSignificant ? "text-red-600" : "text-orange-600"}`}
                        />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-green-600" />
                      )}
                      <span
                        className={`font-semibold ${
                          isSignificant && isHigher
                            ? "text-red-600"
                            : isHigher
                              ? "text-orange-600"
                              : "text-green-600"
                        }`}
                      >
                        {isHigher ? "+" : ""}
                        {variance.toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {charge.sample_size} bills
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="mt-6 p-4 bg-muted/50 rounded-lg text-sm space-y-2">
          <p className="font-semibold">Understanding Charge Variances</p>
          <ul className="space-y-1 text-muted-foreground list-disc list-inside">
            <li>
              <strong className="text-green-600">Green (negative %)</strong>:
              Provider charges less than Medicare rates
            </li>
            <li>
              <strong className="text-orange-600">Orange (0-25%)</strong>:
              Typical markup, within normal range
            </li>
            <li>
              <strong className="text-red-600">Red (&gt;25%)</strong>:
              Significant markup, may warrant scrutiny
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
