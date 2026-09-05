import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  User,
  Mail,
  Shield,
  Heart,
  Download,
  RotateCcw,
  Building2,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PageHeader } from "@/components/PageHeader";
import { ThemeToggleGroup } from "@/components/ThemeToggle";
import { FamilyRosterCard } from "@/components/family/FamilyRosterCard";
import { useRecomputeTiming } from "@/hooks/useHSAEligibility";
import { SubscriptionManagement } from "@/components/settings/SubscriptionManagement";
import { EmailForwardingCard } from "@/components/settings/EmailForwardingCard";
import { useSetOnboardingComplete } from "@/hooks/useOnboardingStatus";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlaidLink } from "@/components/PlaidLink";
import { CategorizationRulesManager } from "@/components/transactions/CategorizationRulesManager";
import { HSAAccountManager } from "@/components/hsa/HSAAccountManager";
import { logError } from "@/utils/errorHandler";

// ── Schemas ──────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  displayName: z.string().max(100),
  hsaOpenedDate: z.string(),
  reimbursementStrategy: z.enum(["regular", "shoebox"]),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

// ── Types ─────────────────────────────────────────────────────────────────────

interface BankConnection {
  id: string;
  institution_name: string | null;
  created_at: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

const Settings = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setOnboardingComplete = useSetOnboardingComplete();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [bankConnections, setBankConnections] = useState<BankConnection[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Workstream D2: the establishment-date cliff is recomputed in the database,
  // in both directions, whenever the HSA date changes.
  const recomputeTiming = useRecomputeTiming();

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: "",
      hsaOpenedDate: "",
      reimbursementStrategy: "regular",
    },
  });

  useEffect(() => {
    loadUserData();
    loadBankConnections();
  }, []);

  const loadUserData = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      setEmail(user.email || "");

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, hsa_opened_date, reimbursement_strategy_preference")
        .eq("id", user.id)
        .single();

      if (profile) {
        profileForm.reset({
          displayName: profile.full_name || "",
          hsaOpenedDate: profile.hsa_opened_date || "",
          reimbursementStrategy:
            profile.reimbursement_strategy_preference === "shoebox"
              ? "shoebox"
              : "regular",
        });
      }

      setLoading(false);
    } catch (error) {
      logError("Error loading user data", error);
      toast.error("Failed to load user data");
    }
  };

  const onSubmitProfile = async (values: ProfileFormValues) => {
    try {
      setSaving(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: oldProfile } = await supabase
        .from("profiles")
        .select("hsa_opened_date")
        .eq("id", user.id)
        .single();

      const oldHsaDate = oldProfile?.hsa_opened_date;
      const hsaDateChanged = oldHsaDate !== values.hsaOpenedDate;

      const { error: upsertError } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          full_name: values.displayName,
          hsa_opened_date: values.hsaOpenedDate || null,
          reimbursement_strategy_preference: values.reimbursementStrategy,
        },
        { onConflict: "id" },
      );
      if (upsertError) throw upsertError;

      // Workstream E6: the strategy is cached for five minutes by
      // useReimbursementStrategy, so without this the user changes the setting,
      // navigates to the dashboard, and finds it unchanged — which reads as the
      // preference not working rather than as a stale cache.
      await queryClient.invalidateQueries({
        queryKey: ["reimbursement-strategy"],
      });
      await queryClient.invalidateQueries({ queryKey: ["attention-items"] });

      if (hsaDateChanged) {
        // Workstream D2. Was two hand-written bulk updates, both filtered on
        // `is_hsa_eligible = true` — a generated column meaning
        // eligibility_state is 'eligible'. Expenses default to 'unknown', so
        // the filter matched almost nothing and the cliff had stopped firing.
        // Neither update ever restored anything either, so a corrected date
        // could not give back what a wrong one took away.
        const { blocked, restored } = await recomputeTiming.mutateAsync();

        if (restored > 0) {
          toast.success(
            `Profile updated. ${restored} expense${restored === 1 ? "" : "s"} ${
              restored === 1 ? "is" : "are"
            } claimable again now that your HSA date is corrected.`,
          );
        } else if (blocked > 0) {
          toast.success(
            `Profile updated. ${blocked} expense${blocked === 1 ? "" : "s"} predate${
              blocked === 1 ? "s" : ""
            } your HSA and can't be reimbursed.`,
          );
        } else {
          toast.success("Profile updated successfully");
        }
      } else {
        toast.success("Profile updated successfully");
      }
    } catch (error) {
      logError("Error updating profile", error);
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const loadBankConnections = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("plaid_connections")
        .select("id, institution_name, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setBankConnections(data || []);
    } catch (error) {
      logError("Error loading bank connections", error);
    }
  };

  const handleDeleteBankConnection = async (id: string) => {
    if (!confirm("Are you sure you want to disconnect this bank account?"))
      return;
    try {
      const { error } = await supabase
        .from("plaid_connections")
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success("Bank account disconnected");
      loadBankConnections();
    } catch (error) {
      logError("Error disconnecting bank", error);
      toast.error("Failed to disconnect bank account");
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== "DELETE MY ACCOUNT") {
      toast.error("Please type the confirmation phrase exactly.");
      return;
    }
    try {
      setDeleting(true);
      const { error } = await supabase.functions.invoke("delete-user-account", {
        body: { confirmation: "DELETE MY ACCOUNT" },
      });
      if (error) throw error;

      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
      navigate("/");
    } catch (error) {
      logError("Error deleting account", error);
      toast.error(
        "Failed to delete account. Please try again or contact support.",
      );
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-4xl">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <div className="mb-8">
          <PageHeader
            title="Account Settings"
            description="Manage your account preferences and security"
          />
        </div>

        <div className="space-y-6">
          <SubscriptionManagement />

          {/* Workstream D1. High on the page deliberately: an unanswered
              tax-dependent question blocks reimbursement for that person, and
              it is not something a user would think to go looking for. */}
          <FamilyRosterCard />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                App Preferences
              </CardTitle>
              <CardDescription>
                Manage your app experience and feature tours
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h4 className="font-medium">Appearance</h4>
                <p className="text-sm text-muted-foreground">
                  "System" follows your device, so Reclaim dims when your device
                  does.
                </p>
                <ThemeToggleGroup />
              </div>

              {/* Was "Reset Feature Tours", which cleared a localStorage flag
                  read by three components that no route rendered — so it reset
                  nothing a user could see. It now clears the real setup marker
                  on the profile and walks the connect-first flow again. */}
              <div className="space-y-2">
                <h4 className="font-medium">Setup</h4>
                <p className="text-sm text-muted-foreground">
                  Walk through connecting a bank, your household, your HSA date
                  and your reimbursement strategy again. Nothing you've already
                  saved is erased.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={setOnboardingComplete.isPending}
                  onClick={async () => {
                    try {
                      await setOnboardingComplete.mutateAsync(false);
                      navigate("/welcome");
                    } catch {
                      toast.error("Couldn't restart setup. Please try again.");
                    }
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Replay setup
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Progressive Web App
              </CardTitle>
              <CardDescription>
                Install Reclaim for a native app experience
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Get instant access, offline support, and push notifications by
                installing Reclaim as an app on your device.
              </p>
              <Button onClick={() => navigate("/install")} variant="outline">
                View Installation Guide
              </Button>
            </CardContent>
          </Card>

          {/* Profile + HSA date share one form */}
          <form onSubmit={profileForm.handleSubmit(onSubmitProfile)}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Profile Information
                </CardTitle>
                <CardDescription>
                  Update your personal information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Email cannot be changed
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    placeholder="Your name"
                    {...profileForm.register("displayName")}
                  />
                  {profileForm.formState.errors.displayName && (
                    <p className="text-sm text-destructive">
                      {profileForm.formState.errors.displayName.message}
                    </p>
                  )}
                </div>
                {/* Reimbursement strategy — drives the Dashboard's primary
                    number + bucket labels and whether submission reminders
                    fire. 'shoebox' = defer reimbursement and grow the balance;
                    'regular' = reimburse on a normal cadence. */}
                <div className="space-y-2">
                  <Label htmlFor="reimbursementStrategy">
                    Reimbursement strategy
                  </Label>
                  <Controller
                    name="reimbursementStrategy"
                    control={profileForm.control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger id="reimbursementStrategy">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="regular">
                            Reimburse regularly — remind me to submit
                          </SelectItem>
                          <SelectItem value="shoebox">
                            Shoebox — defer and grow my HSA balance
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    Shoebox mode treats a documented, unclaimed expense as
                    finished rather than outstanding: Reclaim stops prompting
                    you to claim, and shows the balance as banked. You can still
                    file a claim at any time.
                  </p>
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </CardContent>
            </Card>
          </form>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="h-5 w-5" />
                HSA Accounts
              </CardTitle>
              <CardDescription>
                Manage multiple HSA accounts across different time periods
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HSAAccountManager />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security
              </CardTitle>
              <CardDescription>
                Manage your password and security settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline">Change Password</Button>
            </CardContent>
          </Card>

          {/* Payment Methods removed 2026-08-21.

            This was a hand-kept list of your cards, each with a rewards rate,
            and a checkbox marking one of them as the HSA card. Two problems.
            It never connected to anything: bank sync records which account a
            charge landed on and reads the HSA flag from there, so nothing the
            user typed here was ever consulted. And the rewards rate belonged
            to the retired "which card should I pay with" tool.

            Cards now come from Bank Accounts below, where connecting them is
            what makes them real. */}

          {/* Workstream C3 — rules were previously written silently with no
              screen at all, so a mislabelled vendor was permanent. */}
          <CategorizationRulesManager />

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  <CardTitle>Bank Accounts</CardTitle>
                </div>
                <PlaidLink onSuccess={loadBankConnections} />
              </div>
              <CardDescription>
                Connect your bank accounts to import transactions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {bankConnections.length === 0 ? (
                <div className="text-center py-6">
                  <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">
                    No bank accounts connected
                  </p>
                  <PlaidLink onSuccess={loadBankConnections} />
                </div>
              ) : (
                <div className="space-y-3">
                  {bankConnections.map((connection) => (
                    <div
                      key={connection.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">
                            {connection.institution_name ?? "Linked bank"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Connected{" "}
                            {new Date(
                              connection.created_at,
                            ).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          handleDeleteBankConnection(connection.id)
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <EmailForwardingCard />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Notifications
              </CardTitle>
              <CardDescription>
                Configure how you receive updates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Notification preferences coming soon
              </p>
            </CardContent>
          </Card>

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Delete Account
              </CardTitle>
              <CardDescription>
                Permanently delete your account and all associated data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                This will remove your profile, receipts, transactions, bank
                connections, and all other data from Reclaim. Plaid connections
                will be revoked. This action cannot be undone.
              </p>
              <Dialog
                open={deleteDialogOpen}
                onOpenChange={(open) => {
                  setDeleteDialogOpen(open);
                  if (!open) setDeleteConfirmationText("");
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete My Account
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete your account?</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      This will permanently delete your account and all
                      associated data, and revoke any connected bank accounts.
                      This cannot be undone.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Type{" "}
                      <span className="font-mono font-semibold text-foreground">
                        DELETE MY ACCOUNT
                      </span>{" "}
                      to confirm.
                    </p>
                    <Input
                      value={deleteConfirmationText}
                      onChange={(e) =>
                        setDeleteConfirmationText(e.target.value)
                      }
                      placeholder="DELETE MY ACCOUNT"
                      autoComplete="off"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteDialogOpen(false)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      disabled={
                        deleting ||
                        deleteConfirmationText !== "DELETE MY ACCOUNT"
                      }
                    >
                      {deleting ? "Deleting..." : "Permanently Delete"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthenticatedLayout>
  );
};

export default Settings;
