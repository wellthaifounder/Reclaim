import { useState } from "react";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, TrendingDown } from "lucide-react";
import { logError } from "@/utils/errorHandler";
import { format } from "date-fns";

interface Settlement {
  id: string;
  amount: number;
  notes: string;
  created_at: string;
  type: "offer" | "counter_offer";
}

interface SettlementNegotiationTrackerProps {
  disputeId: string;
  originalAmount: number;
  disputedAmount: number;
}

export const SettlementNegotiationTracker = ({
  disputeId,
  originalAmount,
  disputedAmount,
}: SettlementNegotiationTrackerProps) => {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newAmount, setNewAmount] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [offerType, setOfferType] = useState<"offer" | "counter_offer">(
    "offer",
  );

  const loadSettlements = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("dispute_communications")
        .select("*")
        .eq("dispute_id", disputeId)
        .eq("communication_type", "phone_call")
        .ilike("summary", "%settlement%")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Parse the settlement data from communications
      const parsedSettlements =
        data?.map((comm) => ({
          id: comm.id,
          amount: parseFloat(comm.outcome || "0"),
          notes: comm.summary,
          created_at: comm.created_at,
          type:
            comm.direction === "outbound"
              ? "offer"
              : ("counter_offer" as "offer" | "counter_offer"),
        })) || [];

      setSettlements(parsedSettlements);
    } catch (error: any) {
      toast.error("Error", {
        description: "Failed to load settlement history",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSettlement = async () => {
    if (!newAmount || parseFloat(newAmount) <= 0) {
      toast.error("Invalid Amount", {
        description: "Please enter a valid settlement amount.",
      });
      return;
    }

    setIsAdding(true);
    try {
      const { error } = await supabase.from("dispute_communications").insert([
        {
          dispute_id: disputeId,
          communication_type: (offerType === "offer"
            ? "phone_call"
            : "email") as Database["public"]["Enums"]["communication_type"],
          direction: (offerType === "offer"
            ? "inbound"
            : "outbound") as Database["public"]["Enums"]["communication_direction"],
          summary: `${offerType === "offer" ? "Settlement Offer" : "Counter Offer"}: $${newAmount}`,
          outcome: newNotes || null,
        },
      ]);

      if (error) throw error;

      // Send notification for settlement offers
      if (offerType === "offer") {
        try {
          await supabase.functions.invoke("send-dispute-notification", {
            body: {
              disputeId,
              notificationType: "settlement_offer",
            },
          });
        } catch (notifError) {
          logError("Notification error", notifError);
        }
      }

      toast.success("Success", {
        description: `${offerType === "offer" ? "Offer" : "Counter offer"} recorded successfully.`,
      });

      setNewAmount("");
      setNewNotes("");
      loadSettlements();
    } catch (error) {
      logError("Error adding settlement", error);
      toast.error("Error", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to record settlement. Please try again.",
      });
    } finally {
      setIsAdding(false);
    }
  };

  useState(() => {
    loadSettlements();
  });

  const savingsFromOriginal = originalAmount - (parseFloat(newAmount) || 0);
  const savingsPercentage =
    originalAmount > 0
      ? ((savingsFromOriginal / originalAmount) * 100).toFixed(1)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5" />
          Settlement Negotiation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
          <div>
            <p className="text-sm text-muted-foreground">Original Bill</p>
            <p className="text-lg font-semibold">
              ${originalAmount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Disputed Amount</p>
            <p className="text-lg font-semibold text-orange-600">
              ${disputedAmount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Target Settlement</p>
            <p className="text-lg font-semibold text-green-600">
              ${(originalAmount - disputedAmount).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Add Settlement Offer</Label>
            <div className="flex gap-2">
              <Button
                variant={offerType === "offer" ? "default" : "outline"}
                size="sm"
                onClick={() => setOfferType("offer")}
              >
                Your Offer
              </Button>
              <Button
                variant={offerType === "counter_offer" ? "default" : "outline"}
                size="sm"
                onClick={() => setOfferType("counter_offer")}
              >
                Their Counter
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="amount">Settlement Amount</Label>
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
              {newAmount && (
                <p className="text-sm text-green-600">
                  Save ${savingsFromOriginal.toLocaleString()} (
                  {savingsPercentage}%)
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Additional details..."
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <Button
            onClick={handleAddSettlement}
            disabled={isAdding || !newAmount}
            className="w-full"
          >
            {isAdding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Recording...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Record Settlement Offer
              </>
            )}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : settlements.length > 0 ? (
          <div className="space-y-3">
            <h4 className="font-medium">Negotiation History</h4>
            {settlements.map((settlement) => (
              <div
                key={settlement.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant={
                        settlement.type === "offer" ? "default" : "secondary"
                      }
                    >
                      {settlement.type === "offer"
                        ? "Your Offer"
                        : "Counter Offer"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(settlement.created_at), "MMM d, yyyy")}
                    </span>
                  </div>
                  <p className="text-sm">{settlement.notes}</p>
                </div>
                <p className="text-lg font-semibold ml-4">
                  ${settlement.amount.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No settlement offers recorded yet
          </p>
        )}
      </CardContent>
    </Card>
  );
};
