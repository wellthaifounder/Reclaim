import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

// ── Sections ──────────────────────────────────────────────────────────────────

/**
 * Twelve cards used to sit on one scroll, in the order they happened to be
 * written, so finding anything meant reading all of it. They are four tabs
 * now, grouped by what a person is actually there to do: who I am, who and
 * where the money is, where the money comes from and how it gets sorted, and
 * how the app itself behaves.
 *
 * Which tab is open lives in ?section= rather than local state, for the same
 * reason the Transactions tab does: it survives a refresh and can be linked
 * to. "account" is the default and is spelled by the parameter's absence.
 */
const SETTINGS_SECTIONS = ["account", "household", "banks", "app"] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  account: "Account",
  household: "Household & HSA",
  banks: "Banks & rules",
  app: "App",
};

/**
 * Which tab owns which #anchor.
 *
 * This exists because tabs break deep links by default: an inactive tab's
 * content is not in the document, so `getElementById` on a hash finds nothing
 * and the page just sits on whatever tab was open. Every id targeted by a
 * `/settings#...` link anywhere in the app has to appear here (or match the
 * rule- prefix below), or that link silently lands on the wrong tab.
 */
const SECTION_FOR_ANCHOR: Record<string, SettingsSection> = {
  profile: "account",
  security: "account",
  plan: "account",
  "delete-account": "account",
  family: "household",
  "hsa-accounts": "household",
  "bank-accounts": "banks",
  "categorization-rules": "banks",
  "email-forwarding": "banks",
  appearance: "app",
  install: "app",
  notifications: "app",
};

function sectionForAnchor(anchor: string): SettingsSection | null {
  if (anchor in SECTION_FOR_ANCHOR) return SECTION_FOR_ANCHOR[anchor];
  // Spec D25 links from an overridden rule-filed decision straight to that one
  // rule -- /settings#rule-<uuid>, set on RuleRow in
  // CategorizationRulesManager.tsx. The id carries a uuid, so it is matched by
  // prefix rather than listed.
  if (anchor.startsWith("rule-")) return "banks";
  return null;
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

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const section: SettingsSection =
    requestedSection &&
    (SETTINGS_SECTIONS as readonly string[]).includes(requestedSection)
      ? (requestedSection as SettingsSection)
      : "account";

  const setSection = (next: string) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "account") sp.delete("section");
    else sp.set("section", next);
    setSearchParams(sp, { replace: true });
  };

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

  // Capture the hash and hold it. It has to be held rather than read when
  // needed, because switching tabs writes ?section= through setSearchParams
  // and that navigation drops the hash — so by the time the target tab is
  // mounted there would be nothing left in the URL to scroll to.
  //
  // Taken from the router's location rather than window.location, and keyed
  // on it rather than on mount. A hash-only change is a same-document
  // navigation: nothing remounts and no effect with an empty dependency array
  // ever runs again, so a mount-only read silently does nothing whenever the
  // user is already standing on this page. Today every such link is fired
  // from /transactions, which does remount this page — this keeps that from
  // being load-bearing.
  const location = useLocation();
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (location.hash) setPendingAnchor(location.hash.slice(1));
  }, [location.hash]);

  // Then land on it, in two steps if the anchor belongs to another tab.
  // Nothing mounts until loading clears (see the `if (loading)` early return
  // below), and an inactive tab's content is not in the document at all, so
  // the switch has to happen first and the scroll on the render after it.
  useEffect(() => {
    if (loading || !pendingAnchor) return;
    const owner = sectionForAnchor(pendingAnchor);
    if (owner && owner !== section) {
      setSection(owner);
      return;
    }

    // Scrolling once is not enough, for two separate reasons.
    //
    // The target is usually not in the document yet: Radix mounts the newly
    // active panel's content a beat after `value` changes, so the effect that
    // runs straight after the tab switch finds nothing at all.
    //
    // And once it is there, the page keeps growing above it. Every card on
    // these tabs fetches its own data -- the subscription, bank connections,
    // the rules themselves -- so content arrives above the target and pushes
    // it down after the scroll has already happened. Measured here: a scroll
    // to the delete-account card landed at 954px, and the card then ended up
    // 1854px down, a full screen below where the viewport had stopped.
    //
    // So: poll until the element exists, then re-scroll whenever the document
    // changes size, for up to 2.5s. A size change is the actual event being
    // waited on, which is why this is a ResizeObserver and not a longer
    // guessed delay.
    let timer = 0;
    let observer: ResizeObserver | null = null;
    const scrollToTarget = () =>
      document.getElementById(pendingAnchor)?.scrollIntoView();

    const stop = () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      setPendingAnchor(null);
    };

    const deadline = window.setTimeout(stop, 2500);

    const findAndScroll = () => {
      const el = document.getElementById(pendingAnchor);
      if (!el) {
        timer = window.setTimeout(findAndScroll, 100);
        return;
      }
      el.scrollIntoView();
      observer = new ResizeObserver(scrollToTarget);
      observer.observe(document.body);
    };
    findAndScroll();

    // Never fight the user for the scrollbar: the first thing they do with it
    // ends this.
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      observer?.disconnect();
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
    // setSection is recreated each render (it writes to the URL); including it
    // would re-run this on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pendingAnchor, section]);

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
            title="Settings"
            description="Your details, your household and HSA, the banks you've connected, and how Reclaim behaves"
          />
        </div>

        <Tabs value={section} onValueChange={setSection}>
          {/* Wraps rather than scrolls: four labels fit two-up at 390px, and a
              horizontally scrolling tab strip hides whichever tab falls off
              the right edge with nothing to say it is there. */}
          <TabsList className="mb-6 flex h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="account">
              {SETTINGS_SECTION_LABELS.account}
            </TabsTrigger>
            <TabsTrigger value="household">
              {SETTINGS_SECTION_LABELS.household}
            </TabsTrigger>
            <TabsTrigger value="banks">
              {SETTINGS_SECTION_LABELS.banks}
            </TabsTrigger>
            <TabsTrigger value="app">{SETTINGS_SECTION_LABELS.app}</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-6">
            <div id="profile" className="scroll-mt-20">
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
                        finished rather than outstanding: Reclaim stops
                        prompting you to claim, and shows the balance as banked.
                        You can still file a claim at any time.
                      </p>
                    </div>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : "Save Changes"}
                    </Button>
                  </CardContent>
                </Card>
              </form>
            </div>

            <div id="security" className="scroll-mt-20">
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
            </div>

            <div id="plan" className="scroll-mt-20">
              <SubscriptionManagement />
            </div>

            <div id="delete-account" className="scroll-mt-20">
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
                    connections, and all other data from Reclaim. Plaid
                    connections will be revoked. This action cannot be undone.
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
                          associated data, and revoke any connected bank
                          accounts. This cannot be undone.
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
          </TabsContent>

          <TabsContent value="household" className="space-y-6">
            <div id="family" className="scroll-mt-20">
              {/* Workstream D1. High on the page deliberately: an unanswered
                tax-dependent question blocks reimbursement for that person, and
                it is not something a user would think to go looking for. */}
              <FamilyRosterCard />
            </div>

            <div id="hsa-accounts" className="scroll-mt-20">
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
            </div>
          </TabsContent>

          <TabsContent value="banks" className="space-y-6">
            <div id="bank-accounts" className="scroll-mt-20">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    <CardTitle>Bank Accounts</CardTitle>
                  </div>
                  <CardDescription>
                    Connect your bank accounts to import transactions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* PlaidLink used to sit in the header opposite the title,
                      on a one-line `justify-between` row. It is not a button:
                      it renders the button plus the two-line authorization
                      notice the user has to see before connecting. That block
                      took 662 of the header's 799px and squeezed "Bank
                      Accounts" into a 137px column, wrapping the title. The
                      notice cannot just be dropped -- once a connection
                      exists the empty state below stops rendering, and this
                      is then the only place it appears -- so the control
                      moves down here and gets a full-width line of its own. */}
                  {bankConnections.length === 0 ? (
                    <div className="text-center py-6">
                      <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                      <p className="text-sm text-muted-foreground mb-4">
                        No bank accounts connected
                      </p>
                      <PlaidLink onSuccess={loadBankConnections} />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <PlaidLink onSuccess={loadBankConnections} />
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
            </div>

            {/* Payment Methods removed 2026-08-21.

            This was a hand-kept list of your cards, each with a rewards rate,
            and a checkbox marking one of them as the HSA card. Two problems.
            It never connected to anything: bank sync records which account a
            charge landed on and reads the HSA flag from there, so nothing the
            user typed here was ever consulted. And the rewards rate belonged
            to the retired "which card should I pay with" tool.

            Cards now come from Bank Accounts above, where connecting them is
            what makes them real. */}

            {/* Workstream C3 — rules were previously written silently with no
              screen at all, so a mislabelled vendor was permanent. Spec D24:
              this is now the only place rules are managed (Transactions used
              to open a second copy of this same panel as a dialog) — the id
              is the scroll target for that page's "Rules" button. */}
            <div id="categorization-rules" className="scroll-mt-20">
              <CategorizationRulesManager />
            </div>

            <div id="email-forwarding" className="scroll-mt-20">
              <EmailForwardingCard />
            </div>
          </TabsContent>

          <TabsContent value="app" className="space-y-6">
            <div id="appearance" className="scroll-mt-20">
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
                      "System" follows your device, so Reclaim dims when your
                      device does.
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
                      Walk through connecting a bank, your household, your HSA
                      date and your reimbursement strategy again. Nothing you've
                      already saved is erased.
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
                          toast.error(
                            "Couldn't restart setup. Please try again.",
                          );
                        }
                      }}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Replay setup
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div id="install" className="scroll-mt-20">
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
                    Add Reclaim to your home screen to open it in one tap, full
                    screen, without going through your browser.
                  </p>
                  <Button
                    onClick={() => navigate("/install")}
                    variant="outline"
                  >
                    View Installation Guide
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div id="notifications" className="scroll-mt-20">
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
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AuthenticatedLayout>
  );
};

export default Settings;
