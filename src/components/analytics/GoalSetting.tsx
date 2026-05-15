import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Target, Plus, Trash2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuthUser } from "@/hooks/useAuthUser";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";

interface Goal {
  id: string;
  goal_type: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  is_active: boolean;
}

interface GoalSettingProps {
  currentStats: {
    totalExpenses: number;
    hsaEligible: number;
    unreimbursedHsaTotal: number;
    actualSavings: number;
  };
}

const GOAL_TYPES = {
  monthly_hsa: "Monthly HSA Contributions",
  annual_savings: "Annual Tax Savings",
  unreimbursed_vault: "Unreimbursed HSA Vault",
  rewards_earned: "Credit Card Rewards",
};

export const GoalSetting = ({ currentStats }: GoalSettingProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuthUser();
  const userId = user?.id;
  const [showAddGoal, setShowAddGoal] = useState(false);

  const [newGoal, setNewGoal] = useState({
    goal_type: "annual_savings",
    target_amount: 0,
    deadline: "",
  });

  const {
    data: goals = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["savings_goals", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("savings_goals")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Goal[];
    },
    staleTime: 5 * 60 * 1000,
    meta: { suppressErrorToast: true },
  });

  const calculateCurrentAmount = (goal: Goal) => {
    switch (goal.goal_type) {
      case "annual_savings":
        return currentStats.actualSavings;
      case "unreimbursed_vault":
        return currentStats.unreimbursedHsaTotal;
      case "monthly_hsa":
        return currentStats.hsaEligible / 12;
      case "rewards_earned":
        return currentStats.actualSavings * 0.02;
      default:
        return 0;
    }
  };

  const addGoalMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("savings_goals").insert([
        {
          user_id: user.id,
          goal_type: newGoal.goal_type,
          target_amount: newGoal.target_amount,
          current_amount: 0,
          deadline: newGoal.deadline || null,
        },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Goal added successfully");
      setShowAddGoal(false);
      setNewGoal({
        goal_type: "annual_savings",
        target_amount: 0,
        deadline: "",
      });
      queryClient.invalidateQueries({ queryKey: ["savings_goals"] });
    },
    onError: () => toast.error("Failed to add goal"),
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("savings_goals")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Goal deleted");
      queryClient.invalidateQueries({ queryKey: ["savings_goals"] });
    },
    onError: () => {
      toast.error("Failed to delete goal");
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Savings Goals
          </CardTitle>
          <CardDescription>
            We couldn't load your savings goals right now. Try refreshing the
            page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Savings Goals
            </CardTitle>
            <CardDescription>
              Track progress toward your financial targets
            </CardDescription>
          </div>
          <Button
            onClick={() => setShowAddGoal(!showAddGoal)}
            size="sm"
            variant="outline"
          >
            {showAddGoal ? (
              <X className="h-4 w-4 mr-1" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            {showAddGoal ? "Cancel" : "Add Goal"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {showAddGoal && (
          <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
            <div className="space-y-2">
              <Label>Goal Type</Label>
              <Select
                value={newGoal.goal_type}
                onValueChange={(value) =>
                  setNewGoal({ ...newGoal, goal_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GOAL_TYPES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Target Amount</Label>
              <Input
                type="number"
                placeholder="e.g., 5000"
                value={newGoal.target_amount || ""}
                onChange={(e) =>
                  setNewGoal({
                    ...newGoal,
                    target_amount: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Deadline (Optional)</Label>
              <Input
                type="date"
                value={newGoal.deadline}
                onChange={(e) =>
                  setNewGoal({ ...newGoal, deadline: e.target.value })
                }
              />
            </div>

            <Button
              onClick={() => addGoalMutation.mutate()}
              disabled={addGoalMutation.isPending}
              className="w-full"
            >
              <Check className="h-4 w-4 mr-2" />
              Create Goal
            </Button>
          </div>
        )}

        {goals.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No savings goals yet</p>
            <p className="text-sm mt-1">
              Create your first goal to start tracking progress
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {goals.map((goal) => {
              const current = calculateCurrentAmount(goal);
              const progress = Math.min(
                (current / goal.target_amount) * 100,
                100,
              );
              const isComplete = progress >= 100;

              return (
                <div key={goal.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">
                          {
                            GOAL_TYPES[
                              goal.goal_type as keyof typeof GOAL_TYPES
                            ]
                          }
                        </h4>
                        {isComplete && (
                          <Badge variant="default" className="bg-green-600">
                            <Check className="h-3 w-3 mr-1" />
                            Achieved
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        ${current.toFixed(2)} of $
                        {goal.target_amount.toFixed(2)}
                        {goal.deadline && (
                          <span className="ml-2">
                            • Due{" "}
                            {format(new Date(goal.deadline), "MMM dd, yyyy")}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteGoalMutation.mutate(goal.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Progress value={progress} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{progress.toFixed(0)}% complete</span>
                      <span>
                        ${(goal.target_amount - current).toFixed(2)} to go
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
