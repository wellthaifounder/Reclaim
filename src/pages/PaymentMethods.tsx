import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReclaimLogo } from "@/components/ReclaimLogo";
import { ArrowLeft, Plus, CreditCard, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { logError } from "@/utils/errorHandler";

const PaymentMethods = () => {
  const navigate = useNavigate();
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: "",
    type: "credit_card",
    rewards_rate: "0.02",
  });

  useEffect(() => {
    fetchPaymentMethods();
    fetchRecommendations();
  }, []);

  const fetchPaymentMethods = async () => {
    try {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPaymentMethods(data || []);
    } catch (error) {
      logError("Failed to fetch payment methods:", error);
      toast.error("Failed to load payment methods");
    } finally {
      setLoading(false);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select("category, amount")
        .order("date", { ascending: false })
        .limit(100);

      if (error) throw error;

      // Analyze spending patterns
      const categoryTotals: Record<string, number> = {};
      invoices?.forEach((inv) => {
        categoryTotals[inv.category] =
          (categoryTotals[inv.category] || 0) + Number(inv.amount);
      });

      const sortedCategories = Object.entries(categoryTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

      // Generate recommendations based on spending
      const recs = sortedCategories.map(([category, amount]) => {
        if (category === "Medical" || category === "Pharmacy") {
          return {
            category,
            amount,
            recommendation: "HSA-focused Credit Card",
            description:
              "Consider a card with high rewards on healthcare spending",
            rewardsRate: "3%",
          };
        } else if (category === "Groceries") {
          return {
            category,
            amount,
            recommendation: "Grocery Rewards Card",
            description: "Get up to 6% back on grocery purchases",
            rewardsRate: "6%",
          };
        } else {
          return {
            category,
            amount,
            recommendation: "Cashback Card",
            description: "General cashback for all purchases",
            rewardsRate: "2%",
          };
        }
      });

      setRecommendations(recs);
    } catch (error) {
      logError("Failed to fetch recommendations:", error);
    }
  };

  const handleAddPaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("payment_methods").insert([
        {
          user_id: user.id,
          name: formData.name,
          type: formData.type,
          rewards_rate: Number(formData.rewards_rate),
        },
      ]);

      if (error) throw error;

      toast.success("Payment method added successfully");
      setIsDialogOpen(false);
      setFormData({ name: "", type: "credit_card", rewards_rate: "0.02" });
      fetchPaymentMethods();
    } catch (error) {
      logError("Failed to add payment method:", error);
      toast.error("Failed to add payment method");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("payment_methods")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success("Payment method deleted");
      fetchPaymentMethods();
    } catch (error) {
      logError("Failed to delete payment method:", error);
      toast.error("Failed to delete payment method");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="hover:opacity-80 transition-opacity"
          >
            <ReclaimLogo size="sm" showTagline />
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8 pb-24 md:pb-8">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold mb-2">Payment Methods</h1>
            <p className="text-muted-foreground">
              Track your payment methods and maximize rewards
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Payment Method
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Payment Method</DialogTitle>
                <DialogDescription>
                  Add a new credit card or payment method to track rewards
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddPaymentMethod} className="space-y-4">
                <div>
                  <Label htmlFor="name">Card Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., Chase Sapphire Reserve"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="debit_card">Debit Card</SelectItem>
                      <SelectItem value="hsa_card">HSA Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rewards_rate">Rewards Rate (%)</Label>
                  <Input
                    id="rewards_rate"
                    type="number"
                    step="0.01"
                    value={formData.rewards_rate}
                    onChange={(e) =>
                      setFormData({ ...formData, rewards_rate: e.target.value })
                    }
                    placeholder="e.g., 0.02 for 2%"
                    required
                  />
                </div>
                <Button type="submit" className="w-full">
                  Add Payment Method
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {recommendations.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Personalized Recommendations
              </CardTitle>
              <CardDescription>Based on your spending patterns</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recommendations.map((rec, idx) => (
                  <div key={idx} className="p-4 border rounded-lg bg-accent/20">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-semibold">{rec.recommendation}</h3>
                        <p className="text-sm text-muted-foreground">
                          {rec.description}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-primary">
                        {rec.rewardsRate} rewards
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You spent ${rec.amount.toFixed(2)} on {rec.category}{" "}
                      recently
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your Payment Methods</CardTitle>
            <CardDescription>
              {paymentMethods.length > 0
                ? "Manage your cards and track rewards"
                : "No payment methods added yet"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {paymentMethods.length === 0 ? (
              <div className="text-center py-12">
                <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">
                  Add your payment methods to track rewards
                </p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Your First Card
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {paymentMethods.map((method) => (
                  <div
                    key={method.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <CreditCard className="h-8 w-8 text-primary" />
                      <div>
                        <p className="font-medium">{method.name}</p>
                        <p className="text-sm text-muted-foreground capitalize">
                          {method.type.replace("_", " ")} •{" "}
                          {(Number(method.rewards_rate) * 100).toFixed(1)}%
                          rewards
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(method.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default PaymentMethods;
