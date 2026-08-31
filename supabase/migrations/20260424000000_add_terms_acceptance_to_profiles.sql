-- Add consent tracking columns to profiles table
-- Used to record when a user accepted the Privacy Policy and Terms of Service,
-- and which version of the policy was accepted (for audit / re-consent flows).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS privacy_policy_version_accepted TEXT;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'Timestamp when the user accepted the Privacy Policy / Terms of Service.';

COMMENT ON COLUMN public.profiles.privacy_policy_version_accepted IS
  'Version identifier (date string) of the Privacy Policy the user accepted.';
