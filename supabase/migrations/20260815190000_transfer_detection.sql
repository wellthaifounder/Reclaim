-- Workstream C5 — transfer detection.
--
-- Why this is not optional, from the workflow spec: without it the app's own
-- medical-spend totals are visibly wrong on day one, which is fatal to trust
-- in a finance product. Paying off a credit card used at a pharmacy looks like
-- a second pharmacy purchase; moving money into an HSA looks like spending.
--
-- Two signals, and only the second finds the counterpart:
--
--   1. Plaid's personal_finance_category (TRANSFER_IN/OUT, LOAN_PAYMENTS).
--      Already a hard exclusion in the classifier, so these never classify as
--      medical -- but a category alone cannot say which other transaction is
--      the other half, so it cannot dedupe totals.
--   2. A matched pair: money out of one account and the same amount into
--      another of the user's accounts, within a few days. This is what lets us
--      say "these two rows are one movement of money, count neither as
--      spending."

-- ── 1. Columns ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_kind') THEN
    CREATE TYPE public.transfer_kind AS ENUM (
      -- Checking -> credit card. The one that needs a user-facing warning:
      -- the reimbursable expense is the original merchant charge on the card,
      -- NOT the payment that settles the card balance.
      'card_payment',
      -- Between the user's own depository accounts.
      'internal',
      -- Money leaving the HSA. Usually a reimbursement arriving; the deposit
      -- matcher in E4 pairs it to an open substantiation record.
      'hsa_distribution',
      -- Money into the HSA. A contribution, never an expense.
      'hsa_contribution'
    );
  END IF;
END
$$;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS transfer_counterpart_id UUID
    REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_kind public.transfer_kind,
  ADD COLUMN IF NOT EXISTS transfer_detected_at TIMESTAMPTZ;

COMMENT ON COLUMN public.transactions.is_transfer IS
  'Money moved between the user''s own accounts. Excluded from spending totals
   and from categorization — a transfer is not a purchase.';
COMMENT ON COLUMN public.transactions.transfer_counterpart_id IS
  'The other half of the movement. Symmetric: if A points at B, B points at A.';

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_pairing
  ON public.transactions (user_id, transaction_date, signed_amount)
  WHERE is_transfer = FALSE AND plaid_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_is_transfer
  ON public.transactions (user_id) WHERE is_transfer;

-- ── 2. Pair detection ─────────────────────────────────────────────────────
--
-- Greedy nearest-date matching, not a global optimum. With several identical
-- transfers in flight (three $500 moves in a week) any assignment is equally
-- defensible, and the user-visible outcome — both halves excluded from totals
-- — is identical whichever way they pair up. A full assignment solve would buy
-- nothing and would be far harder to reason about.
--
-- Deliberate constraints:
--   * different accounts. Two rows on one account cannot be a transfer, and
--     without this a refund would pair with its own purchase.
--   * opposite signs that cancel within tolerance. signed_amount follows
--     Plaid: positive is money out.
--   * neither side already paired, so one debit cannot absorb two credits.
--   * a window, because a card payment posts a day or two after it leaves
--     checking.

CREATE OR REPLACE FUNCTION public.detect_transfers(
  p_user_id       UUID,
  p_lookback_days INTEGER DEFAULT 45,
  p_window_days   INTEGER DEFAULT 5,
  p_tolerance     NUMERIC DEFAULT 0.01
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pairs INTEGER := 0;
BEGIN
  WITH candidates AS (
    SELECT
      out_t.id  AS out_id,
      in_t.id   AS in_id,
      out_acct.is_hsa AS out_is_hsa,
      in_acct.is_hsa  AS in_is_hsa,
      in_acct.type    AS in_type,
      out_acct.type   AS out_type,
      ABS(in_t.transaction_date - out_t.transaction_date) AS day_gap,
      ROW_NUMBER() OVER (
        PARTITION BY out_t.id
        ORDER BY ABS(in_t.transaction_date - out_t.transaction_date), in_t.id
      ) AS out_rank,
      ROW_NUMBER() OVER (
        PARTITION BY in_t.id
        ORDER BY ABS(in_t.transaction_date - out_t.transaction_date), out_t.id
      ) AS in_rank
    FROM public.transactions out_t
    JOIN public.plaid_accounts out_acct ON out_acct.id = out_t.plaid_account_id
    JOIN public.transactions in_t
      ON in_t.user_id = out_t.user_id
     AND in_t.plaid_account_id IS DISTINCT FROM out_t.plaid_account_id
     AND in_t.signed_amount < 0
     AND ABS(out_t.signed_amount + in_t.signed_amount) <= p_tolerance
     AND ABS(in_t.transaction_date - out_t.transaction_date) <= p_window_days
     AND in_t.is_transfer = FALSE
    JOIN public.plaid_accounts in_acct ON in_acct.id = in_t.plaid_account_id
    WHERE out_t.user_id = p_user_id
      AND out_t.signed_amount > 0
      AND out_t.is_transfer = FALSE
      AND out_t.plaid_account_id IS NOT NULL
      AND out_t.transaction_date >= CURRENT_DATE - p_lookback_days
  ),
  -- Keep only mutual best matches, so a single debit cannot claim two credits
  -- and vice versa.
  paired AS (
    SELECT out_id, in_id, out_is_hsa, in_is_hsa, in_type, out_type
    FROM candidates
    WHERE out_rank = 1 AND in_rank = 1
  ),
  classified AS (
    SELECT
      out_id, in_id,
      CASE
        WHEN out_is_hsa THEN 'hsa_distribution'::public.transfer_kind
        WHEN in_is_hsa  THEN 'hsa_contribution'::public.transfer_kind
        -- Money landing on a credit account settles a card balance.
        WHEN in_type = 'credit' THEN 'card_payment'::public.transfer_kind
        ELSE 'internal'::public.transfer_kind
      END AS kind
    FROM paired
  ),
  -- Both halves get flagged, each pointing at the other.
  both_sides AS (
    SELECT out_id AS id, in_id AS counterpart, kind FROM classified
    UNION ALL
    SELECT in_id AS id, out_id AS counterpart, kind FROM classified
  )
  UPDATE public.transactions t
  SET is_transfer = TRUE,
      transfer_counterpart_id = b.counterpart,
      transfer_kind = b.kind,
      transfer_detected_at = now(),
      -- A transfer is not a purchase, so it leaves the review queue and stops
      -- counting as medical whatever the merchant string said.
      is_medical = FALSE,
      needs_review = FALSE,
      classification_reason = 'transfer',
      classification_explanation = CASE b.kind
        WHEN 'card_payment' THEN
          'Credit card payment, matched to the deposit on the card. Not a purchase — reimburse the original charges on the card instead.'
        WHEN 'hsa_distribution' THEN
          'Money out of your HSA, matched to the deposit in your other account.'
        WHEN 'hsa_contribution' THEN
          'Contribution into your HSA, matched to the withdrawal from your other account.'
        ELSE
          'Transfer between your own accounts, matched to its other half.'
      END,
      updated_at = now()
  FROM both_sides b
  WHERE t.id = b.id
    AND t.user_id = p_user_id;

  GET DIAGNOSTICS v_pairs = ROW_COUNT;
  -- Rows updated counts both halves; report movements, not rows.
  RETURN v_pairs / 2;
END;
$$;

-- ── 3. Undo one pairing ───────────────────────────────────────────────────
-- Detection is a heuristic. Two unrelated same-amount transactions days apart
-- can pair, and the user has to be able to say so — otherwise a false positive
-- silently erases a real expense from their totals, which is the exact failure
-- this workstream exists to prevent.

CREATE OR REPLACE FUNCTION public.unlink_transfer(p_transaction_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_counterpart UUID;
  v_count       INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT transfer_counterpart_id INTO v_counterpart
  FROM public.transactions
  WHERE id = p_transaction_id AND user_id = v_user_id;

  UPDATE public.transactions
  SET is_transfer = FALSE,
      transfer_counterpart_id = NULL,
      transfer_kind = NULL,
      transfer_detected_at = NULL,
      -- Back to the review queue: we no longer claim to know what this is.
      needs_review = TRUE,
      classification_reason = 'user',
      classification_explanation = 'You said this is not a transfer.',
      updated_at = now()
  WHERE user_id = v_user_id
    AND id IN (p_transaction_id, v_counterpart);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 4. Keep transfers out of the ledger ───────────────────────────────────
-- The ledger view feeds the spending figures. A transfer appearing here is
-- precisely the double-count this workstream removes.

-- Column-for-column identical to the definition in 20260814120000. Only the
-- WHERE clause is new. Do not "tidy" this list — the Ledger page selects these
-- names, and an omission surfaces as a runtime query error, not a build one.
DROP VIEW IF EXISTS public.ledger_entries;

CREATE VIEW public.ledger_entries AS
SELECT
  i.id AS invoice_id,
  i.user_id,
  i.vendor,
  i.category,
  i.date AS service_date,
  i.invoice_date,
  i.amount AS billed_amount,
  i.total_amount,
  i.is_hsa_eligible,
  i.is_reimbursed,
  i.documentation_state,
  i.eligibility_state,
  i.claim_state,
  i.amount_paid,
  i.reimbursable_amount,
  i.reimbursed_amount,
  i.status AS invoice_status,
  i.collection_id,
  i.invoice_number,
  i.notes AS invoice_notes,
  i.created_at AS invoice_created_at,
  COALESCE(pay.total_paid, 0) AS total_paid,
  COALESCE(pay.paid_via_hsa, 0) AS paid_via_hsa,
  COALESCE(pay.paid_via_oop, 0) AS paid_via_oop,
  COALESCE(i.amount, 0) - COALESCE(pay.total_paid, 0) AS outstanding_balance,
  COALESCE(pay.payment_count, 0) AS payment_count,
  COALESCE(pay.has_auto_linked, false) AS has_auto_linked,
  pay.latest_payment_date,
  COALESCE(txn.linked_transaction_count, 0) AS linked_transaction_count,
  CASE
    WHEN COALESCE(pay.payment_count, 0) = 0 THEN 'unmatched'
    WHEN COALESCE(pay.has_auto_linked, false) THEN 'auto_matched'
    ELSE 'manual'
  END AS match_status,
  c.title AS care_event_title
FROM invoices i
LEFT JOIN LATERAL (
  SELECT
    SUM(pt.amount) AS total_paid,
    SUM(CASE WHEN pt.payment_source = 'hsa_direct' THEN pt.amount ELSE 0 END) AS paid_via_hsa,
    SUM(CASE WHEN pt.payment_source = 'out_of_pocket' THEN pt.amount ELSE 0 END) AS paid_via_oop,
    COUNT(*) AS payment_count,
    bool_or(pt.auto_linked) AS has_auto_linked,
    MAX(pt.payment_date) AS latest_payment_date
  FROM payment_transactions pt
  WHERE pt.invoice_id = i.id
) pay ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS linked_transaction_count
  FROM transactions t
  WHERE t.invoice_id = i.id
) txn ON true
LEFT JOIN collections c ON c.id = i.collection_id
-- The only change: an expense captured from a transaction later identified as
-- a transfer is not a real expense and must not reach spending totals.
-- Excluded rather than deleted, so unlinking the transfer brings it back.
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t
  WHERE t.id = i.source_transaction_id
    AND t.is_transfer
);
