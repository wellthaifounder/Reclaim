import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Settings, Eye, EyeOff, RotateCcw } from "lucide-react";
import {
  useDashboardLayout,
  DASHBOARD_CARDS,
} from "@/contexts/DashboardLayoutContext";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface DashboardCustomizationProps {
  currentTab: string;
  hasHSA: boolean;
}

export function DashboardCustomization({
  currentTab,
  hasHSA,
}: DashboardCustomizationProps) {
  const { toggleCardVisibility, resetLayout, isCardVisible } =
    useDashboardLayout();

  const getCategoryTitle = (category: string) => {
    switch (category) {
      case "overview":
        return "Overview";
      case "bills":
        return "Bill Intelligence";
      case "hsa":
        return "HSA & Money";
      case "transactions":
        return "Transactions";
      default:
        return category;
    }
  };

  const categories = [
    "overview",
    "bills",
    ...(hasHSA ? ["hsa"] : []),
    "transactions",
  ] as const;
  const currentCategory = currentTab as (typeof categories)[number];

  const cardsForCategory = DASHBOARD_CARDS.filter(
    (card) =>
      card.category === currentCategory && (card.category !== "hsa" || hasHSA),
  );

  const visibleCount = cardsForCategory.filter((card) =>
    isCardVisible(card.id),
  ).length;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">Customize</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Dashboard Customization
          </SheetTitle>
          <SheetDescription>
            Show or hide cards to personalize your{" "}
            {getCategoryTitle(currentCategory)} view
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Visible Cards</h3>
                <Badge variant="secondary">
                  {visibleCount}/{cardsForCategory.length}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {getCategoryTitle(currentCategory)} tab
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetLayout}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>

          <Separator />

          <div className="space-y-3">
            {cardsForCategory.map((card) => {
              const visible = isCardVisible(card.id);
              return (
                <div
                  key={card.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {visible ? (
                      <Eye className="h-4 w-4 text-primary" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Label
                      htmlFor={card.id}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {card.title}
                    </Label>
                  </div>
                  <Switch
                    id={card.id}
                    checked={visible}
                    onCheckedChange={() => toggleCardVisibility(card.id)}
                  />
                </div>
              );
            })}
          </div>

          {cardsForCategory.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No cards available for this tab</p>
            </div>
          )}

          <Separator />

          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Tips:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Toggle switches to show or hide cards</li>
              <li>Changes are saved automatically</li>
              <li>Click "Reset" to restore default layout</li>
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
