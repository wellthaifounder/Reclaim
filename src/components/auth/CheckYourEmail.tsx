import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { describeResendError } from "@/lib/signupErrors";

// How long the resend button rests after a send. The auth server refuses a
// second email to the same address inside its own window (60 seconds by
// default); resting the button for the same stretch means the refusal is
// rarely the first thing a person sees.
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Shown in place of the sign-up form once an account has been created and the
 * project is waiting for the address to be confirmed. Names the address so a
 * typo is noticed, and offers the two things a person can do about a missing
 * email: send it again, or go back and correct the address.
 */
export function CheckYourEmail({
  email,
  onUseDifferentEmail,
}: {
  email: string;
  onUseDifferentEmail: () => void;
}) {
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentAgain, setSentAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    setResending(true);
    setError(null);
    setSentAgain(false);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (resendError) throw resendError;
      setSentAgain(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(describeResendError(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="space-y-5 py-2 text-center" data-testid="check-your-email">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Mail className="h-6 w-6 text-primary" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-heading">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to
        </p>
        <p className="break-all font-medium">{email}</p>
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={resending || cooldown > 0}
          onClick={resend}
        >
          {resending
            ? "Sending…"
            : cooldown > 0
              ? `Resend email (${cooldown}s)`
              : "Resend email"}
        </Button>
        {sentAgain && cooldown > 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            Sent again to {email}.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={onUseDifferentEmail}
      >
        Use a different email
      </Button>
    </div>
  );
}
