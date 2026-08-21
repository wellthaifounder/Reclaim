-- Drop the care-event and second-payment tables.
--
-- This is the last of the out-of-scope schema. Seven tables, in three groups:
--
--   collections            The care-event grouping. Grouping expenses by
--                          vendor or visit is deferred past v1 while the core
--                          object model settles, and every surface that read
--                          it is gone.
--
--   payment_transactions   A second record of "this expense was paid", parallel
--   payment_methods        to the bank transaction the expense was captured
--   payment_labels         from. Reclaim's expenses exist BECAUSE the bank saw
--                          the money leave, so a separate payments table could
--                          only ever hold a second, disagreeing answer to
--                          "how much has been paid". payment_methods was a
--                          hand-typed list of cards with a rewards rate, from
--                          the retired "which card should I pay with" tool;
--                          its is_hsa_account flag duplicated
--                          plaid_accounts.is_hsa, which is the one the sync
--                          actually reads.
--
--   labels                 The predecessor of tags. `tags` + `expense_tags`
--   invoice_labels         are the live implementation, reached from the
--   receipt_labels         substantiation panel. Nothing in the app has
--                          referenced the labels tables since; every component
--                          that did was a closed loop with no entry point.
--
-- All seven are empty in every environment. There are no production users.
--
-- Order matters: dependent triggers and functions first, then the view, then
-- the foreign-key columns on surviving tables, then the tables themselves.

BEGIN;

-- ── 1. Triggers on surviving tables ──────────────────────────────────────────
-- These two fire on EVERY write to invoices. Leaving them behind would break
-- saving an expense the moment `collections` disappeared.
DROP TRIGGER IF EXISTS trg_collection_status_on_invoice ON public.invoices;
DROP TRIGGER IF EXISTS trigger_update_collection_totals ON public.invoices;

-- Triggers on the doomed tables go with them, but dropping explicitly keeps
-- this migration readable as a list of everything being removed.
DROP TRIGGER IF EXISTS trg_update_invoice_status_insert ON public.payment_transactions;
DROP TRIGGER IF EXISTS trg_update_invoice_status_update ON public.payment_transactions;
DROP TRIGGER IF EXISTS trg_update_invoice_status_delete ON public.payment_transactions;
DROP TRIGGER IF EXISTS trigger_update_collection_paid ON public.payment_transactions;
DROP TRIGGER IF EXISTS update_payment_transactions_updated_at ON public.payment_transactions;
DROP TRIGGER IF EXISTS trg_recompute_collection_status ON public.collections;

-- ── 2. Functions ─────────────────────────────────────────────────────────────
-- Care-event status and totals.
DROP FUNCTION IF EXISTS public.recompute_collection_status_on_invoice_change() CASCADE;
DROP FUNCTION IF EXISTS public.recompute_collection_status() CASCADE;
DROP FUNCTION IF EXISTS public.compute_collection_status(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_collection_totals() CASCADE;
DROP FUNCTION IF EXISTS public.update_collection_paid() CASCADE;
-- Argument lists matter here: DROP FUNCTION matches on the full signature, so
-- the no-argument form of either of these silently drops nothing.
DROP FUNCTION IF EXISTS public.detect_claimable_care_events(uuid, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.suggest_invoice_clusters(uuid) CASCADE;

-- invoices.status was maintained from the payments table: 'unpaid' until
-- payment rows covered the amount. With no payments table there is nothing to
-- maintain it from, and nothing reads it any more -- the "unpaid bills older
-- than 30 days" counter that did was removed in the same change. The column
-- itself is left in place; it is harmless at its default and dropping it is a
-- separate, riskier edit to a 62-column table.
DROP FUNCTION IF EXISTS public.update_invoice_status() CASCADE;
DROP FUNCTION IF EXISTS public.compute_invoice_status(uuid) CASCADE;

-- ── 3. The ledger view ───────────────────────────────────────────────────────
-- Fed the /ledger page, which was retired on 2026-08-20. It sums
-- payment_transactions and joins collections, so it cannot outlive either.
DROP VIEW IF EXISTS public.ledger_entries;

-- ── 4. Rebuild merge_duplicate_expenses without the dropped columns ──────────
-- This one is live: it is what the duplicate warning's "merge" button calls.
-- Only the two COALESCE lines for collection_id and payment_method_id are
-- removed; everything else is unchanged from the previous definition.
CREATE OR REPLACE FUNCTION public.merge_duplicate_expenses(
  p_candidate_id uuid,
  p_keep_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user     UUID;
  v_a        UUID;
  v_b        UUID;
  v_drop_id  UUID;
  v_keep     invoices%ROWTYPE;
  v_drop     invoices%ROWTYPE;
  v_note     TEXT;
BEGIN
  SELECT user_id, expense_a_id, expense_b_id
    INTO v_user, v_a, v_b
    FROM expense_duplicate_candidates
   WHERE id = p_candidate_id
     AND status = 'open'
   FOR UPDATE;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Duplicate candidate not found or already resolved';
  END IF;
  IF v_user <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_keep_id NOT IN (v_a, v_b) THEN
    RAISE EXCEPTION 'The expense to keep must be one of the two in this pair';
  END IF;

  v_drop_id := CASE WHEN p_keep_id = v_a THEN v_b ELSE v_a END;

  -- Take both row locks in id order, never in keep/drop order. Two merges
  -- racing on an overlapping pair -- A+B and B+C, say -- would otherwise be
  -- able to grab the two locks in opposite orders and deadlock.
  PERFORM 1 FROM invoices WHERE id = LEAST(p_keep_id, v_drop_id) FOR UPDATE;
  PERFORM 1 FROM invoices WHERE id = GREATEST(p_keep_id, v_drop_id) FOR UPDATE;

  SELECT * INTO v_keep FROM invoices WHERE id = p_keep_id;
  SELECT * INTO v_drop FROM invoices WHERE id = v_drop_id;

  IF v_keep.id IS NULL OR v_drop.id IS NULL THEN
    RAISE EXCEPTION 'One of these expenses no longer exists';
  END IF;

  -- Re-checked here rather than trusting the state at detection time: a user
  -- can submit a reimbursement request between the warning appearing and their
  -- clicking merge. Deleting an expense that a submitted request references
  -- would break the snapshot that request depends on.
  IF v_drop.claim_state NOT IN ('unclaimed', 'not_reimbursable') THEN
    RAISE EXCEPTION
      'This expense has already been claimed and cannot be merged away';
  END IF;
  IF EXISTS (SELECT 1 FROM substantiation_record_items s WHERE s.invoice_id = v_drop.id) THEN
    RAISE EXCEPTION
      'This expense is part of a submitted reimbursement request and cannot be merged away';
  END IF;

  -- Documents move rather than die. This is the whole point of merging instead
  -- of asking the user to delete one: the hand-entered record usually carries
  -- the receipt, and the synced record usually carries the true amount paid.
  UPDATE receipts SET invoice_id = v_keep.id WHERE invoice_id = v_drop.id;

  -- Any transaction that pointed at the discarded expense now points at the
  -- survivor, so the bank row stays linked to something real.
  UPDATE transactions
     SET invoice_id = v_keep.id,
         reconciliation_status = 'linked_to_invoice'
   WHERE invoice_id = v_drop.id;

  -- Detach the discarded row's identity BEFORE deleting it. Both source
  -- columns carry unique indexes, so the survivor cannot adopt them while the
  -- discarded row still holds them.
  UPDATE invoices
     SET source_plaid_transaction_id = NULL,
         source_transaction_id       = NULL,
         source_email_message_id     = NULL
   WHERE id = v_drop.id;

  v_note := COALESCE(v_keep.notes || E'\n', '')
            || 'Merged with a duplicate record for the same charge ('
            || COALESCE(v_drop.vendor, 'unknown vendor') || ', '
            || TO_CHAR(v_drop.date, 'Mon DD YYYY') || ', $'
            || TO_CHAR(COALESCE(v_drop.amount_paid, v_drop.amount), 'FM999999990.00')
            || ') on ' || TO_CHAR(now(), 'Mon DD YYYY') || '.';

  UPDATE invoices SET
    -- Only ever fill gaps. Overwriting a value the user chose on the record
    -- they asked to KEEP would make merge feel like it destroyed their work.
    patient_name                = COALESCE(v_keep.patient_name, v_drop.patient_name),
    invoice_number              = COALESCE(v_keep.invoice_number, v_drop.invoice_number),
    npi_number                  = COALESCE(v_keep.npi_number, v_drop.npi_number),
    hsa_account_id              = COALESCE(v_keep.hsa_account_id, v_drop.hsa_account_id),
    eligibility_basis_rule_id   = COALESCE(v_keep.eligibility_basis_rule_id,
                                           v_drop.eligibility_basis_rule_id),
    -- The bank link is worth inheriting: it is what stops a future sync
    -- auto-capturing this charge a third time.
    source_plaid_transaction_id = COALESCE(v_keep.source_plaid_transaction_id,
                                           v_drop.source_plaid_transaction_id),
    source_transaction_id       = COALESCE(v_keep.source_transaction_id,
                                           v_drop.source_transaction_id),
    -- Documentation is a fact about which files exist, and the files just
    -- moved, so take the better of the two.
    documentation_state = (
      SELECT s FROM (VALUES (v_keep.documentation_state), (v_drop.documentation_state)) AS t(s)
       ORDER BY CASE s WHEN 'complete' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END
       LIMIT 1
    ),
    -- Eligibility is a judgement, so an unresolved survivor may inherit a
    -- decision, but a decided survivor is never overruled by the discarded row.
    eligibility_state = CASE
      WHEN v_keep.eligibility_state = 'unknown' THEN v_drop.eligibility_state
      ELSE v_keep.eligibility_state
    END,
    notes      = v_note,
    updated_at = now()
  WHERE id = v_keep.id;

  -- Cascades through the candidate rows referencing it, including this one.
  -- That is intentional: the duplicate no longer exists, so there is nothing
  -- left to warn about, and the merge is recorded in the survivor's notes
  -- where the user will actually read it.
  DELETE FROM invoices WHERE id = v_drop.id;

  RETURN v_keep.id;
END;
$function$;

-- ── 5. Foreign-key columns on surviving tables ───────────────────────────────
ALTER TABLE public.invoices     DROP COLUMN IF EXISTS collection_id;
ALTER TABLE public.invoices     DROP COLUMN IF EXISTS payment_method_id;
ALTER TABLE public.receipts     DROP COLUMN IF EXISTS collection_id;
ALTER TABLE public.receipts     DROP COLUMN IF EXISTS payment_transaction_id;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS payment_method_id;

-- ── 6. The tables ────────────────────────────────────────────────────────────
-- Child tables first so the drops need no CASCADE, which would otherwise be
-- able to take something unintended with it.
DROP TABLE IF EXISTS public.payment_labels;
DROP TABLE IF EXISTS public.invoice_labels;
DROP TABLE IF EXISTS public.receipt_labels;
DROP TABLE IF EXISTS public.labels;
DROP TABLE IF EXISTS public.payment_transactions;
DROP TABLE IF EXISTS public.payment_methods;
DROP TABLE IF EXISTS public.collections;

-- ── 7. Guard ─────────────────────────────────────────────────────────────────
-- Assert that the drop took exactly what it meant to and nothing else. If a
-- CASCADE reached further than intended, this fails and the whole migration
-- rolls back rather than leaving a half-demolished schema behind.
DO $$
DECLARE
  missing TEXT;
  survivors TEXT[] := ARRAY[
    'analytics_events','categorization_rules','expense_duplicate_candidates',
    'expense_tags','family_members','hsa_accounts','invoices','matching_run_log',
    'mcc_codes','plaid_accounts','plaid_connections','profiles','pub_502_rules',
    'receipt_ocr_data','receipts','reimbursement_match_candidates',
    'rule_applications','substantiation_record_items','substantiation_records',
    'tags','transaction_splits','transactions','vendor_aliases'
  ];
BEGIN
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(survivors) AS t
   WHERE to_regclass('public.' || t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Drop removed tables it should not have: %', missing;
  END IF;

  -- The link this whole change relies on: an expense knows which bank
  -- transaction it came from. If that column went, the payments table was
  -- load-bearing after all and this migration is wrong.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoices'
       AND column_name = 'source_transaction_id'
  ) THEN
    RAISE EXCEPTION 'invoices.source_transaction_id is missing';
  END IF;

  -- And the reverse link, which the Plaid auto-matcher writes.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'transactions'
       AND column_name = 'invoice_id'
  ) THEN
    RAISE EXCEPTION 'transactions.invoice_id is missing';
  END IF;

  -- The HSA-card guard. Everything that used to read
  -- payment_methods.is_hsa_account now reads this instead.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'plaid_accounts'
       AND column_name = 'is_hsa'
  ) THEN
    RAISE EXCEPTION 'plaid_accounts.is_hsa is missing';
  END IF;

  -- Nothing may still point at what was just dropped. Two functions survived
  -- an earlier draft of this migration because DROP FUNCTION was written with
  -- the wrong argument list and matched nothing -- a silent no-op that leaves
  -- a function referencing tables which no longer exist, failing only when
  -- someone finally calls it. This catches that class of miss.
  SELECT string_agg(p.proname, ', ') INTO missing
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ ('(payment_transactions|payment_methods|payment_labels'
                  || '|invoice_labels|receipt_labels|\mcollections\M'
                  || '|collection_id|payment_method_id|payment_transaction_id)');

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'These functions still reference dropped objects: %', missing;
  END IF;
END $$;

COMMIT;
