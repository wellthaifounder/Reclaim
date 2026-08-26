-- Remove tables belonging to products Reclaim is no longer building.
--
-- The app was rebuilt around bank sync -- categorize, substantiate, reimburse
-- -- and the UI for everything below was retired on 2026-08-19/20. The tables
-- outlived their screens. Empty tables are not free: they carry RLS policies
-- to audit, appear in the generated types every developer reads, and invite
-- the question "should this be wired up?" every time someone new opens the
-- schema. There are no production users, so there is no data to preserve and
-- no migration path to write.
--
-- Three groups, each self-contained: every foreign key pointing at a table
-- dropped here comes from another table dropped here. Nothing that survives
-- loses a column, which is why this migration needs no ALTER TABLE at all.
--
-- Deliberately NOT dropped, and why:
--
--   collections, payment_transactions, payment_methods, payment_labels
--       Also out of scope, but surviving tables still carry foreign keys to
--       them (invoices.collection_id, receipts.collection_id,
--       invoices.payment_method_id, transactions.payment_method_id,
--       receipts.payment_transaction_id) and live screens still read them.
--       Dropping these means removing working features first, so they get
--       their own migration rather than being smuggled into this one.
--
--   wellbie_conversations, wellbie_messages, wellbie_attachments
--       Deferred to v1.1, not cancelled. FF.WELLBIE_ENABLED gates the UI and
--       the plan is to switch it back on. Deferred is not out of scope.
--
--   rule_applications
--       Looks orphaned -- nothing reads it yet -- but the spec explicitly
--       asks for a rules screen that can "list, edit, delete, and see what
--       each rule has affected", with every application reversible and
--       showing its provenance. That is this table. Unbuilt, not unwanted.

BEGIN;

-- ── 1. Provider directory and hospital price transparency ────────────────
-- A V2 feature. Its pages were archived long ago (src/_archived/pages/
-- ProviderDirectory, ProviderDetail, ProviderTransparency) and the last live
-- reader -- an inert provider lookup on the expense detail page that fetched
-- a row and discarded it -- went with this migration.
DROP TABLE IF EXISTS public.procedure_insights CASCADE;
DROP TABLE IF EXISTS public.provider_charge_benchmarks CASCADE;
DROP TABLE IF EXISTS public.provider_bills CASCADE;
DROP TABLE IF EXISTS public.regional_benchmarks CASCADE;
DROP TABLE IF EXISTS public.transparency_metrics CASCADE;
DROP TABLE IF EXISTS public.hospital_pricing CASCADE;
DROP TABLE IF EXISTS public.hospitals CASCADE;

-- ── 2. Provider reviews ──────────────────────────────────────────────────
-- Cut on 2026-08-19: a ratings system is a different product and is off the
-- roadmap. review_moderation_log depends on reviews, provider_reviews on
-- providers; all three go together, and providers goes with them.
DROP TABLE IF EXISTS public.review_moderation_log CASCADE;
DROP TABLE IF EXISTS public.provider_reviews CASCADE;
DROP TABLE IF EXISTS public.reviews CASCADE;
DROP TABLE IF EXISTS public.providers CASCADE;

-- ── 3. Superseded by the rebuild ─────────────────────────────────────────
--   inbox_items            the Ledger's triage queue. ReviewFeed on
--                          /transactions does this job now, off `transactions`
--                          directly.
--   expense_decisions      an earlier attempt at recording categorize
--                          outcomes; the expense facets on `invoices` hold
--                          this now.
--   user_vendor_preferences  silently-written vendor memory with no UI and no
--                          way to undo a mislabel. The spec names this
--                          explicitly as something that must not survive --
--                          categorization_rules replaces it, with provenance.
--   savings_goals          belonged to the savings calculator, deleted
--                          2026-08-20.
DROP TABLE IF EXISTS public.inbox_items CASCADE;
DROP TABLE IF EXISTS public.expense_decisions CASCADE;
DROP TABLE IF EXISTS public.user_vendor_preferences CASCADE;
DROP TABLE IF EXISTS public.savings_goals CASCADE;

-- ── Guard ────────────────────────────────────────────────────────────────
-- CASCADE is doing real work above, so prove it only reached what it was
-- aimed at: the tables the rebuild depends on must all still be here, with
-- the columns that link them intact.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY[
    'invoices','receipts','receipt_ocr_data','transactions','transaction_splits',
    'plaid_accounts','plaid_connections','profiles','hsa_accounts','family_members',
    'pub_502_rules','mcc_codes','categorization_rules','rule_applications',
    'vendor_aliases','expense_duplicate_candidates','substantiation_records',
    'substantiation_record_items','reimbursement_match_candidates',
    'matching_run_log','analytics_events','collections','payment_transactions'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'CASCADE removed tables the rebuild needs: %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoices'
      AND column_name='source_transaction_id'
  ) THEN
    RAISE EXCEPTION
      'invoices.source_transaction_id is gone -- the expense/transaction link';
  END IF;
END $$;

COMMIT;
