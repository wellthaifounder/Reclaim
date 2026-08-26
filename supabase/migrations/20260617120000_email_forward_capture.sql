-- Reclaim — Email-forward receipt capture
-- Date: 2026-06-17
--
-- Adds the data needed to ingest receipts that users forward/email to a
-- personal inbound address. The inbound-email webhook resolves the user purely
-- from a secret token embedded in the recipient address (the From header is
-- spoofable on forwarded mail and is never trusted for identity), then feeds the
-- attachment into the SAME capture -> OCR -> classify -> confirm pipeline as the
-- upload wizard. No new downstream workflow.
--
-- Two slices:
--   1. `profiles` gets a per-user inbound token + an on/off switch.
--   2. `invoices` gets source tracking + a dedupe guard (mirrors the existing
--      `source_plaid_transaction_id` partial-unique pattern) so a redelivered
--      webhook can't create duplicate invoices for the same email.
--
-- Idempotent (IF NOT EXISTS) so it is safe to re-run / runnable from an empty
-- schema after profiles + invoices exist.

-- ── 1. profiles: per-user inbound email token ────────────────────────────────
-- A volatile gen_random_uuid() default is evaluated per-row on ADD COLUMN, so
-- every existing profile gets a distinct token and the UNIQUE constraint holds.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_forward_token TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS email_forward_enabled BOOLEAN NOT NULL DEFAULT true;

-- UNIQUE via index (so IF NOT EXISTS is available; a table constraint is not
-- conditionally creatable). This is the lookup path the webhook uses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_forward_token
  ON public.profiles(email_forward_token);

COMMENT ON COLUMN public.profiles.email_forward_token IS
  'Reclaim: secret token forming the user''s personal inbound receipt address (<token>@inbound.wellth-ai.app). Resolves the owning user for forwarded-receipt ingestion. Rotatable by the user; rotating invalidates the old address.';
COMMENT ON COLUMN public.profiles.email_forward_enabled IS
  'Reclaim: when false, the inbound-email webhook ignores mail to this user''s address (no capture).';

-- ── 2. invoices: source tracking + email dedupe ──────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS source_email_received_at TIMESTAMPTZ;

COMMENT ON COLUMN public.invoices.source IS
  'Reclaim: how this invoice was created — one of wizard | manual | plaid | email. NULL for pre-existing rows.';
COMMENT ON COLUMN public.invoices.source_email_message_id IS
  'Reclaim: provider message id of the forwarded email that created this invoice. NULL unless source = email. Partial UNIQUE index prevents duplicate capture on webhook redelivery.';

-- Partial UNIQUE: only rows created from email participate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_source_email_message_id_unique
  ON public.invoices(source_email_message_id)
  WHERE source_email_message_id IS NOT NULL;
