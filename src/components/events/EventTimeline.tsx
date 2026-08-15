import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Receipt,
  FileCheck,
  Stethoscope,
  CreditCard,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type TimelineItemType = "invoice" | "payment" | "document" | "dispute";

interface TimelineItem {
  id: string;
  type: TimelineItemType;
  title: string;
  description?: string;
  amount?: number;
  date: string;
  document_type?: string;
  status?: string;
}

interface EventTimelineProps {
  items: TimelineItem[];
  onItemClick?: (item: TimelineItem) => void;
}

const TYPE_CONFIG: Record<
  TimelineItemType,
  { icon: typeof FileText; color: string; bgColor: string }
> = {
  invoice: { icon: Receipt, color: "text-blue-600", bgColor: "bg-blue-100" },
  payment: {
    icon: CreditCard,
    color: "text-green-600",
    bgColor: "bg-green-100",
  },
  document: { icon: FileText, color: "text-gray-600", bgColor: "bg-gray-100" },
  dispute: {
    icon: AlertTriangle,
    color: "text-orange-600",
    bgColor: "bg-orange-100",
  },
};

const DOCUMENT_TYPE_ICONS: Record<string, typeof FileText> = {
  bill: Receipt,
  itemized_statement: FileCheck,
  eob: FileText,
  doctors_notes: Stethoscope,
  payment_receipt: CreditCard,
};

export function EventTimeline({ items, onItemClick }: EventTimelineProps) {
  // Sort items by date, newest first
  const sortedItems = [...items].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No items yet</p>
        <p className="text-sm">
          Upload documents or add invoices to see them here
        </p>
      </div>
    );
  }

  return (
    <div className="relative space-y-4">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

      {sortedItems.map((item, _index) => {
        const config = TYPE_CONFIG[item.type];
        const Icon = item.document_type
          ? DOCUMENT_TYPE_ICONS[item.document_type] || config.icon
          : config.icon;

        return (
          <div
            key={`${item.type}-${item.id}`}
            className={cn(
              "relative flex gap-4 pl-10",
              onItemClick &&
                "cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-2 rounded-lg",
            )}
            onClick={() => onItemClick?.(item)}
          >
            {/* Timeline dot */}
            <div
              className={cn(
                "absolute left-2 w-5 h-5 rounded-full flex items-center justify-center",
                config.bgColor,
              )}
            >
              <Icon className={cn("h-3 w-3", config.color)} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.title}</p>
                  {item.description && (
                    <p className="text-sm text-muted-foreground truncate">
                      {item.description}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {item.amount !== undefined && (
                    <p
                      className={cn(
                        "font-semibold",
                        item.type === "payment" ? "text-green-600" : "",
                      )}
                    >
                      {item.type === "payment" ? "-" : ""}$
                      {item.amount.toFixed(2)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(item.date), "MMM d, yyyy")}
                  </p>
                </div>
              </div>

              {/* Status badge */}
              {item.status && (
                <Badge variant="outline" className="mt-1 text-xs">
                  {item.status.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
