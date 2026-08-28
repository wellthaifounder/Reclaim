import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ReclaimLogo } from "@/components/ReclaimLogo";
import { toast } from "sonner";
import { z } from "zod";

const PRIVACY_POLICY_VERSION = "2026-04-24";

// Inline Google brand mark. Matches Google's color tokens.
const GoogleIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const OrDivider = () => (
  <div className="relative py-1">
    <div className="absolute inset-0 flex items-center">
      <span className="w-full border-t" />
    </div>
    <div className="relative flex justify-center">
      <span className="bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
        or
      </span>
    </div>
  </div>
);

const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100),
});

const signInSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255),
  password: z.string().min(1, "Password is required"),
});

const resetSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255),
});

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Landing-page CTAs that lead users into a *new* account flow append `?signup=1`
  // so the right tab is selected on arrival. Direct visits to /auth (e.g. a returning
  // user typing the URL) still default to Sign In.
  const initialTab =
    searchParams.get("signup") === "1" || searchParams.get("tab") === "signup"
      ? "signup"
      : "signin";
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  // Both auth paths are shown at once (2026-08-27), email/password first.
  //
  // Google used to be the only visible option, with email/password collapsed
  // behind a "More options" toggle. That is the wrong default for this
  // product specifically: the people most likely to hesitate before attaching
  // their Google identity to an app that reads their bank transactions and
  // their medical spending are exactly the people this is built for. Hiding
  // the alternative spent that hesitation at the moment of highest intent.
  //
  // `?email=1` is still accepted so older links (a forgot-password mail, for
  // instance) keep working; it just has nothing left to expand.

  // Sign up form
  const [signUpData, setSignUpData] = useState({
    fullName: "",
    email: "",
    password: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Sign in form
  const [signInData, setSignInData] = useState({
    email: "",
    password: "",
  });

  // Reset password
  const [resetEmail, setResetEmail] = useState("");

  const validateSignUpField = (field: string, value: string) => {
    const partial = { ...signUpData, [field]: value };
    const result = signUpSchema.safeParse(partial);
    if (result.success) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    } else {
      const fieldError = result.error.issues.find((i) => i.path[0] === field);
      if (fieldError) {
        setFieldErrors((prev) => ({ ...prev, [field]: fieldError.message }));
      } else {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    }
  };

  useEffect(() => {
    // Wave 5 (2026-05-06): UserIntentDialog deleted. Everyone defaults to
    // user_intent='both'; users refine it in Settings if they want. Auth
    // state machine is now: signed-in → /dashboard, no intermediate gate.
    const checkUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) navigate("/dashboard");
    };
    checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session && event === "SIGNED_IN") {
        // Persist any pending terms acceptance from a Google OAuth sign-up
        const pending = sessionStorage.getItem("pendingTermsAcceptance");
        if (pending) {
          try {
            const { accepted_at, version } = JSON.parse(pending);
            await supabase
              .from("profiles")
              .update({
                terms_accepted_at: accepted_at,
                privacy_policy_version_accepted: version,
              })
              .eq("id", session.user.id);
          } catch {
            // ignore — non-blocking
          }
          sessionStorage.removeItem("pendingTermsAcceptance");
        }
        navigate("/dashboard");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!termsAccepted) {
      toast.error("Please agree to the Privacy Policy to continue.");
      return;
    }

    try {
      const validated = signUpSchema.parse(signUpData);
      setLoading(true);

      const acceptedAt = new Date().toISOString();
      const { data: signUpResult, error } = await supabase.auth.signUp({
        email: validated.email,
        password: validated.password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: {
            full_name: validated.fullName,
            terms_accepted_at: acceptedAt,
            privacy_policy_version_accepted: PRIVACY_POLICY_VERSION,
          },
        },
      });

      if (error) throw error;

      // `session` is null exactly when the project requires email confirmation.
      // That single fact decides everything below, so read it once.
      const needsConfirmation = !signUpResult.session;

      // Default user_intent='both' so HSA features are visible without forcing
      // an intent picker upfront (Wave 5, 2026-05-06). The migration also sets
      // 'both' as the column default; this explicit write covers the case
      // where the trigger inserts the row before the user is fully provisioned.
      //
      // Only attempted with a session: with confirmation on there is no auth
      // yet, so row-level security rejects this write. The two consent values
      // are not lost -- they were passed as user metadata on signUp above and
      // are recorded against the auth user either way.
      if (signUpResult.user && !needsConfirmation) {
        await supabase
          .from("profiles")
          .update({
            user_intent: "both",
            terms_accepted_at: acceptedAt,
            privacy_policy_version_accepted: PRIVACY_POLICY_VERSION,
          })
          .eq("id", signUpResult.user.id);
      }

      // Best-effort welcome email. The edge function is auth-gated and only
      // mails the caller's own address; a failure here must never block signup,
      // so swallow errors (it just won't send if there's no session yet).
      if (signUpResult.session) {
        supabase.functions.invoke("send-welcome-email").catch(() => {});
      }

      // Tell the truth about what has to happen next. This previously said
      // "Account created! You can now sign in." unconditionally -- and with
      // confirmation required, signing in immediately fails with "Email not
      // confirmed", which reads as the account not having been created at all.
      if (needsConfirmation) {
        toast.success(
          `Check ${validated.email} for a confirmation link. You'll be able to sign in once you've opened it.`,
          { duration: 10000 },
        );
      } else {
        toast.success("Account created! You can now sign in.");
      }
      setSignUpData({ fullName: "", email: "", password: "" });
      setTermsAccepted(false);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        toast.error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const validated = signInSchema.parse(signInData);
      setLoading(true);

      const { error } = await supabase.auth.signInWithPassword({
        email: validated.email,
        password: validated.password,
      });

      if (error) throw error;

      toast.success("Welcome back!");
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        // Supabase returns the bare string "Email not confirmed" here, which
        // tells someone what is wrong but not what to do, and gives no hint
        // that the link is sitting in their inbox (or their spam folder).
        if (/email not confirmed/i.test(error.message)) {
          toast.error(
            "Confirm your email first — we sent a link when you signed up. Check your spam folder if it isn't there.",
            { duration: 10000 },
          );
        } else {
          toast.error(error.message);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const validated = resetSchema.parse({ email: resetEmail });
      setLoading(true);

      const { error } = await supabase.auth.resetPasswordForEmail(
        validated.email,
        {
          redirectTo: `${window.location.origin}/auth`,
        },
      );

      if (error) throw error;

      toast.success("Password reset email sent! Check your inbox.");
      setResetEmail("");
      setShowReset(false);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      } else if (error instanceof Error) {
        toast.error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
        },
      });

      if (error) throw error;
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (!termsAccepted) {
      toast.error("Please agree to the Privacy Policy to continue.");
      return;
    }
    sessionStorage.setItem(
      "pendingTermsAcceptance",
      JSON.stringify({
        accepted_at: new Date().toISOString(),
        version: PRIVACY_POLICY_VERSION,
      }),
    );
    await handleGoogleSignIn();
  };

  if (showReset) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex justify-center mb-4">
              <ReclaimLogo size="md" />
            </div>
            <CardTitle className="text-2xl text-center font-heading">
              Reset Password
            </CardTitle>
            <CardDescription className="text-center">
              Enter your email to receive a password reset link
            </CardDescription>
          </CardHeader>
          <form onSubmit={handlePasswordReset}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="name@example.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-2">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending..." : "Send Reset Link"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setShowReset(false)}
              >
                Back to Sign In
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-2">
            <ReclaimLogo size="md" showTagline />
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={initialTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-4">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    value={signInData.email}
                    onChange={(e) =>
                      setSignInData({
                        ...signInData,
                        email: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    autoComplete="current-password"
                    value={signInData.password}
                    onChange={(e) =>
                      setSignInData({
                        ...signInData,
                        password: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="w-full"
                  onClick={() => setShowReset(true)}
                >
                  Forgot password?
                </Button>
              </form>

              <OrDivider />

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <GoogleIcon className="mr-2 h-4 w-4" />
                Continue with Google
              </Button>
            </TabsContent>

            <TabsContent value="signup" className="space-y-4">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="John Doe"
                    value={signUpData.fullName}
                    onChange={(e) =>
                      setSignUpData({
                        ...signUpData,
                        fullName: e.target.value,
                      })
                    }
                    onBlur={(e) =>
                      validateSignUpField("fullName", e.target.value)
                    }
                    required
                  />
                  {fieldErrors.fullName && (
                    <p className="text-sm text-destructive">
                      {fieldErrors.fullName}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="name@example.com"
                    value={signUpData.email}
                    onChange={(e) =>
                      setSignUpData({
                        ...signUpData,
                        email: e.target.value,
                      })
                    }
                    onBlur={(e) => validateSignUpField("email", e.target.value)}
                    required
                  />
                  {fieldErrors.email && (
                    <p className="text-sm text-destructive">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="Min. 8 characters"
                    value={signUpData.password}
                    onChange={(e) =>
                      setSignUpData({
                        ...signUpData,
                        password: e.target.value,
                      })
                    }
                    onBlur={(e) =>
                      validateSignUpField("password", e.target.value)
                    }
                    required
                  />
                  {fieldErrors.password && (
                    <p className="text-sm text-destructive">
                      {fieldErrors.password}
                    </p>
                  )}
                  {!fieldErrors.password &&
                    signUpData.password.length > 0 &&
                    signUpData.password.length >= 8 && (
                      <p className="text-sm text-green-600">
                        Password strength: OK
                      </p>
                    )}
                </div>
                {/* Terms gate BOTH paths, so this sits above the two buttons
                    rather than inside either one. */}
                <div className="flex items-start space-x-2 pt-1">
                  <Checkbox
                    id="terms-accepted"
                    checked={termsAccepted}
                    onCheckedChange={(checked) =>
                      setTermsAccepted(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="terms-accepted"
                    className="text-xs font-normal leading-relaxed text-muted-foreground"
                  >
                    I agree to Reclaim's{" "}
                    <a
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Privacy Policy
                    </a>{" "}
                    and consent to the collection, processing, and storage of my
                    data as described therein.
                  </Label>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || !termsAccepted}
                >
                  {loading ? "Creating account..." : "Create Account"}
                </Button>
              </form>

              <OrDivider />

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                onClick={handleGoogleSignUp}
                disabled={loading || !termsAccepted}
              >
                <GoogleIcon className="mr-2 h-4 w-4" />
                Continue with Google
              </Button>
              {!termsAccepted && (
                <p className="text-center text-xs text-muted-foreground">
                  Accept the terms above to continue with either option.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
