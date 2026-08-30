-- Track whether the welcome email has been sent, so sending it is idempotent.
--
-- Why this is needed: the welcome email was being triggered at signup, guarded
-- by `if (signUpResult.session)`. In production email confirmation is required,
-- so signup never returns a session and the call never fired -- nobody who has
-- ever signed up received one. The right moment is the first successful
-- sign-in, after the address is confirmed.
--
-- But "first sign-in" is not something the client can know on its own, and a
-- client that calls on every sign-in would mail the user every time. This
-- column makes the edge function the authority: it claims the flag before
-- sending, so the client can safely call it on every sign-in and exactly one
-- email goes out.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.welcome_email_sent_at IS
  'When the welcome email was sent; NULL means not yet. Claimed by '
  'send-welcome-email before it sends, and reset to NULL if the send fails so '
  'a later sign-in retries. Row-level security is already enabled on this '
  'table and the existing "Users can update their own profile" policy covers '
  'this column -- the function acts as the signed-in user, not as an admin.';
