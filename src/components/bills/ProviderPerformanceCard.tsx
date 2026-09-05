import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Building2, TrendingUp, AlertTriangle, Star } from "lucide-react";

interface ProviderPerformanceCardProps {
  provider: {
    id: string;
    name: string;
    billing_accuracy_score: number;
    total_bills_analyzed: number;
    total_overcharges_found: number;
    overall_rating: number;
    city?: string;
    state?: string;
  };
}

export function ProviderPerformanceCard({
  provider,
}: ProviderPerformanceCardProps) {
  const accuracyScore = Number(provider.billing_accuracy_score);
  const isHighAccuracy = accuracyScore >= 90;
  const isLowAccuracy = accuracyScore < 70;

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex gap-3">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{provider.name}</CardTitle>
              {provider.city && provider.state && (
                <p className="text-sm text-muted-foreground mt-1">
                  {provider.city}, {provider.state}
                </p>
              )}
            </div>
          </div>

          {provider.overall_rating > 0 && (
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
              <span className="font-semibold">
                {Number(provider.overall_rating).toFixed(1)}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Accuracy Score */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              Billing Accuracy
            </span>
            <div className="flex items-center gap-2">
              {isHighAccuracy ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : isLowAccuracy ? (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              ) : null}
              <span
                className={`font-bold ${
                  isHighAccuracy
                    ? "text-green-600"
                    : isLowAccuracy
                      ? "text-red-600"
                      : "text-orange-600"
                }`}
              >
                {accuracyScore.toFixed(1)}%
              </span>
            </div>
          </div>
          <Progress value={accuracyScore} className="h-2" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div>
            <p className="text-xs text-muted-foreground">Bills Analyzed</p>
            <p className="font-semibold">{provider.total_bills_analyzed}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Overcharges Found</p>
            <Money
              value={Number(provider.total_overcharges_found)}
              className="block font-semibold text-orange-600"
            />
          </div>
        </div>

        {/* Warning for low accuracy */}
        {isLowAccuracy && (
          <Badge variant="destructive" className="w-full justify-center">
            Low Billing Accuracy - Review Bills Carefully
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
