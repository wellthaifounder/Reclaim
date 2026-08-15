import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfidenceIndicator, ConfidenceBar } from "./ConfidenceIndicator";
import {
  Sparkles,
  Edit2,
  Check,
  X,
  AlertTriangle,
  Building2,
  DollarSign,
  Calendar,
  FileText,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ExtractedField {
  value: string | number | null;
  confidence: number;
  source?: string;
}

interface BillMetadata {
  provider_name?: ExtractedField;
  total_amount?: ExtractedField;
  service_date?: ExtractedField;
  bill_date?: ExtractedField;
  invoice_number?: ExtractedField;
  category?: ExtractedField;
}

interface AIExtractionCardProps {
  metadata: BillMetadata;
  overallConfidence: number;
  warnings?: string[];
  onFieldUpdate?: (field: keyof BillMetadata, value: string | number) => void;
  onConfirm?: () => void;
  isEditable?: boolean;
}

// Annotated rather than inferred: only total_amount carries a `prefix`, so an
// inferred type made `config.prefix` unreachable on the union of entries.
type FieldConfig = {
  label: string;
  icon: LucideIcon;
  type: "text" | "number" | "date";
  placeholder: string;
  prefix?: string;
};

const FIELD_CONFIG: Record<keyof BillMetadata, FieldConfig> = {
  provider_name: {
    label: "Provider",
    icon: Building2,
    type: "text" as const,
    placeholder: "Healthcare provider name",
  },
  total_amount: {
    label: "Total Amount",
    icon: DollarSign,
    type: "number" as const,
    placeholder: "0.00",
    prefix: "$",
  },
  service_date: {
    label: "Service Date",
    icon: Calendar,
    type: "date" as const,
    placeholder: "YYYY-MM-DD",
  },
  bill_date: {
    label: "Bill Date",
    icon: Calendar,
    type: "date" as const,
    placeholder: "YYYY-MM-DD",
  },
  invoice_number: {
    label: "Invoice/Account #",
    icon: FileText,
    type: "text" as const,
    placeholder: "Account or invoice number",
  },
  category: {
    label: "Category",
    icon: Tag,
    type: "text" as const,
    placeholder: "e.g., Lab Work, Office Visit",
  },
};

function EditableField({
  field,
  data,
  onUpdate,
  isEditable,
}: {
  field: keyof BillMetadata;
  data: ExtractedField | undefined;
  onUpdate?: (value: string | number) => void;
  isEditable: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    data?.value !== null && data?.value !== undefined ? String(data.value) : "",
  );
  const config = FIELD_CONFIG[field];
  const Icon = config.icon;
  const needsVerification = data && data.confidence < 0.9;

  const handleSave = () => {
    if (onUpdate) {
      const finalValue =
        config.type === "number" ? parseFloat(editValue) || 0 : editValue;
      onUpdate(finalValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(
      data?.value !== null && data?.value !== undefined
        ? String(data.value)
        : "",
    );
    setIsEditing(false);
  };

  const displayValue = () => {
    if (data?.value === null || data?.value === undefined)
      return "Not detected";
    if (field === "total_amount") {
      return `$${Number(data.value).toFixed(2)}`;
    }
    return String(data.value);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border transition-colors",
        needsVerification
          ? "bg-yellow-50 border-yellow-200"
          : "bg-background border-border",
      )}
    >
      <div
        className={cn(
          "p-2 rounded-lg",
          needsVerification ? "bg-yellow-100" : "bg-muted",
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4",
            needsVerification ? "text-yellow-600" : "text-muted-foreground",
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Label className="text-xs text-muted-foreground">
            {config.label}
          </Label>
          {data && (
            <ConfidenceIndicator confidence={data.confidence} size="sm" />
          )}
        </div>

        {isEditing ? (
          <div className="flex items-center gap-2">
            {config.prefix && (
              <span className="text-sm text-muted-foreground">
                {config.prefix}
              </span>
            )}
            <Input
              type={config.type}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={handleSave}
            >
              <Check className="h-4 w-4 text-green-600" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={handleCancel}
            >
              <X className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium truncate",
                !data?.value && "text-muted-foreground italic",
              )}
            >
              {displayValue()}
            </span>
            {isEditable && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {needsVerification && (
        <Badge
          variant="outline"
          className="bg-yellow-100 text-yellow-700 border-yellow-300 text-xs"
        >
          Verify
        </Badge>
      )}
    </div>
  );
}

export function AIExtractionCard({
  metadata,
  overallConfidence,
  warnings = [],
  onFieldUpdate,
  onConfirm,
  isEditable = true,
}: AIExtractionCardProps) {
  const fieldsNeedingVerification = Object.entries(metadata).filter(
    ([, data]) => data && data.confidence < 0.9,
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">AI Extracted Information</CardTitle>
          </div>
          <Badge
            variant={overallConfidence >= 0.9 ? "default" : "secondary"}
            className={cn(
              overallConfidence >= 0.9
                ? "bg-green-100 text-green-700 hover:bg-green-100"
                : overallConfidence >= 0.7
                  ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-100"
                  : "bg-red-100 text-red-700 hover:bg-red-100",
            )}
          >
            {Math.round(overallConfidence * 100)}% confident
          </Badge>
        </div>
        <ConfidenceBar confidence={overallConfidence} className="mt-3" />
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {warnings.length > 0 && (
          <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              {warnings.map((warning, i) => (
                <p key={i} className="text-sm text-yellow-800">
                  {warning}
                </p>
              ))}
            </div>
          </div>
        )}

        {fieldsNeedingVerification.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 px-3 py-2 rounded-lg">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Please verify {fieldsNeedingVerification.length} field
              {fieldsNeedingVerification.length > 1 ? "s" : ""} marked in yellow
            </span>
          </div>
        )}

        <div className="grid gap-3">
          {(Object.keys(FIELD_CONFIG) as Array<keyof BillMetadata>).map(
            (field) => (
              <div key={field} className="group">
                <EditableField
                  field={field}
                  data={metadata[field]}
                  onUpdate={
                    onFieldUpdate
                      ? (value) => onFieldUpdate(field, value)
                      : undefined
                  }
                  isEditable={isEditable}
                />
              </div>
            ),
          )}
        </div>

        {onConfirm && (
          <div className="pt-2">
            <Button onClick={onConfirm} className="w-full gap-2">
              <Check className="h-4 w-4" />
              Confirm & Save Bill
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
