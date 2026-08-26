// Reclaim — "Email receipts in" settings card.
//
// Shows the user's personal inbound address (<token>@<domain>) that forwards
// receipts straight into the capture -> review pipeline, with copy / enable /
// rotate controls. Identity is the secret token in the address, so rotating it
// invalidates the old address immediately.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Switch } from "@/components/ui/switch";
import { Forward, Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

// Must match INBOUND_EMAIL_DOMAIN in the inbound-email-webhook edge function.
const INBOUND_DOMAIN =
  import.meta.env.VITE_INBOUND_EMAIL_DOMAIN || "inbound.wellth-ai.app";

// The new profile columns aren't in the generated Supabase types yet; scope an
// untyped client to this card so the build stays green until types regenerate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function EmailForwardingCard() {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await db
        .from("profiles")
        .select("email_forward_token, email_forward_enabled")
        .eq("id", user.id)
        .single();
      if (data) {
        setToken(data.email_forward_token ?? null);
        setEnabled(data.email_forward_enabled ?? true);
      }
    } catch (error) {
      logError("Error loading email forwarding settings", error);
    } finally {
      setLoading(false);
    }
  };

  const address = token ? `${token}@${INBOUND_DOMAIN}` : "";

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  };

  const handleToggle = async (next: boolean) => {
    setBusy(true);
    const prev = enabled;
    setEnabled(next);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await db
        .from("profiles")
        .update({ email_forward_enabled: next })
        .eq("id", user.id);
      if (error) throw error;
      toast.success(next ? "Email capture enabled" : "Email capture paused");
    } catch (error) {
      setEnabled(prev);
      logError("Error updating email forwarding", error);
      toast.error("Failed to update setting");
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    if (
      !confirm(
        "Generate a new address? Your current address will stop working immediately.",
      )
    )
      return;
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const newToken = crypto.randomUUID();
      const { error } = await db
        .from("profiles")
        .update({ email_forward_token: newToken })
        .eq("id", user.id);
      if (error) throw error;
      setToken(newToken);
      toast.success("New address generated");
    } catch (error) {
      logError("Error rotating email forwarding token", error);
      toast.error("Failed to generate a new address");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Forward className="h-5 w-5" />
          Email Receipts In
        </CardTitle>
        <CardDescription>
          Forward any receipt email to your personal address — we'll read it,
          check IRS eligibility, and drop it in your review queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="inbound-address">Your receipt address</Label>
          <div className="flex gap-2">
            <Input
              id="inbound-address"
              value={loading ? "Loading…" : address}
              readOnly
              className="bg-muted font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleCopy}
              disabled={!address || busy}
              aria-label="Copy address"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Forward receipts here from any inbox. PDFs and photos both work.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Accept emailed receipts</p>
            <p className="text-xs text-muted-foreground">
              When off, mail to your address is ignored.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={loading || busy}
            aria-label="Toggle emailed receipts"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRotate}
          disabled={loading || busy}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Generate new address
        </Button>
      </CardContent>
    </Card>
  );
}
