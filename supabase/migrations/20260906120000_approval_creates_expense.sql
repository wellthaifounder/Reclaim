-- Confirming a transaction as medical is what creates its expense.
--
-- The bug this fixes, found in live use on 2026-09-06: an account with six
-- confirmed-medical transactions worth $2,642.13 had ZERO expenses. Every
-- downstream screen was correct to show nothing — Substantiate, the dashboard
-- total and the reimbursement record all read `invoices`, and no invoice
-- existed. The money was stranded at step one of a three-step product with no
-- way forward, and no error anywhere to say so.
--
-- Root cause: expenses were only ever created by `autoCaptureExpenses` during a
-- Plaid sync, over the transactions ingested in THAT run, for whatever the
-- classifier judged medical at that instant. Every other route to "this is
-- medical" — a categorization rule, a confirmation in the review queue, the
-- mark-as-medical button — updated `transactions` and created nothing. The
-- manual escape hatch ("Link to a bill") was deliberately removed on
-- 2026-08-21 on the reasoning that sync already makes the link itself, which is
-- true only for transactions medical at the moment they arrive.
--
-- Re-syncing could never have healed it either: Plaid does not resend
-- transactions it has already delivered, so capture never saw them again.
--
-- The fix puts the invariant in the database rather than in whichever call site
-- remembers it: a transaction that is confirmed medical HAS an expense. That is
-- deliberate. A missed call site here does not throw — it silently strands
-- someone's money, which is precisely the failure being repaired.

-- ── 1. The expense-creating trigger ──────────────────────────────────────────
--
-- Fires on INSERT as well as UPDATE. Insert matters because a categorization
-- rule can confirm a transaction at ingestion, and an AFTER UPDATE trigger
-- would never see that row.
--
-- SECURITY DEFINER so the same path works for the user's own UPDATE (RLS on
-- invoices would otherwise apply), the service-role webhook, and the backfill
-- at the bottom of this file. user_id is always taken from the transaction
-- being confirmed, never from auth.uid(), so the definer rights cannot be used
-- to write a row onto another account.
CREATE OR REPLACE FUNCTION public.create_expense_on_medical_confirmation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_hsa     BOOLEAN := false;
  v_invoice_id UUID;
BEGIN
  -- Money moved between the user's own accounts is not a purchase. Capturing a
  -- credit-card payment as an expense either double-counts the original charge
  -- or claims something that was never medical.
  IF NEW.is_transfer IS TRUE THEN
    RETURN NEW;
  END IF;

  -- A split parent's money is claimed through its children, which carry their
  -- own expenses (see ExpenseSplitDialog). Capturing the parent as well would
  -- claim the same basket twice.
  IF NEW.is_split IS TRUE OR NEW.split_parent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Already has one. Both checks are needed: invoice_id covers the normal case,
  -- the EXISTS covers a row whose link was cleared but whose expense survives.
  IF NEW.invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.source_transaction_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  -- Spend on an HSA card is a distribution: it still needs substantiation, but
  -- it can never become a reimbursement request. HSA-ness lives on
  -- plaid_accounts, not on the transaction.
  --
  -- transactions.plaid_account_id is a UUID foreign key to plaid_accounts.id —
  -- NOT Plaid's own text account id, which is plaid_accounts.plaid_account_id.
  -- Joining the two by name compares uuid to text and fails outright.
  SELECT COALESCE(pa.is_hsa, false)
    INTO v_is_hsa
    FROM public.plaid_accounts pa
   WHERE pa.id = NEW.plaid_account_id
     AND pa.user_id = NEW.user_id
   LIMIT 1;
  -- A manually entered transaction has no account at all; SELECT INTO leaves
  -- the variable NULL rather than false when nothing matched.
  v_is_hsa := COALESCE(v_is_hsa, false);

  INSERT INTO public.invoices (
    user_id,
    vendor,
    amount,
    date,
    category,
    -- Eligibility is NOT decided here. It depends on date of service, patient
    -- and Pub 502 category, none of which a bank transaction knows. The
    -- expense starts 'unknown' and substantiation resolves it.
    eligibility_state,
    documentation_state,
    claim_state,
    amount_paid,
    reimbursable_amount,
    source_transaction_id,
    source_plaid_transaction_id,
    notes
  ) VALUES (
    NEW.user_id,
    COALESCE(NULLIF(NEW.vendor, ''), NEW.description),
    NEW.amount,
    NEW.transaction_date,
    'Medical',
    -- Cast every enum explicitly. A bare literal would coerce, but the CASE
    -- below is typed text and the column rejects it outright, which would make
    -- confirming a transaction fail rather than silently misfile it.
    'unknown'::expense_eligibility_state,
    'none'::expense_documentation_state,
    (CASE WHEN v_is_hsa THEN 'not_reimbursable' ELSE 'unclaimed' END)::expense_claim_state,
    NEW.amount,
    NEW.amount,
    NEW.id,
    NEW.plaid_transaction_id,
    'Created when this transaction was confirmed as medical.'
  )
  RETURNING id INTO v_invoice_id;

  -- Back-link. This re-enters the trigger, but the UPDATE changes neither
  -- is_medical nor needs_review, so the WHEN clauses below are false and it
  -- stops here rather than recursing.
  UPDATE public.transactions
     SET invoice_id            = v_invoice_id,
         reconciliation_status = 'linked_to_invoice',
         updated_at            = now()
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_expense_on_medical_confirmation() IS
  'Reclaim 2026-09-06: guarantees a confirmed-medical transaction always has an expense. Confirmation means is_medical AND NOT needs_review — the user has approved it, or one of their own rules did.';

-- "Confirmed" is is_medical true AND needs_review false. The classifier now
-- always leaves needs_review true when it finds a medical signal, so the only
-- things that reach these triggers are the user's approval and the user's own
-- standing rules.
DROP TRIGGER IF EXISTS trg_transactions_confirm_medical_ins ON public.transactions;
CREATE TRIGGER trg_transactions_confirm_medical_ins
AFTER INSERT ON public.transactions
FOR EACH ROW
WHEN (NEW.is_medical IS TRUE AND NEW.needs_review IS NOT TRUE)
EXECUTE FUNCTION public.create_expense_on_medical_confirmation();

DROP TRIGGER IF EXISTS trg_transactions_confirm_medical_upd ON public.transactions;
CREATE TRIGGER trg_transactions_confirm_medical_upd
AFTER UPDATE ON public.transactions
FOR EACH ROW
WHEN (
  NEW.is_medical IS TRUE
  AND NEW.needs_review IS NOT TRUE
  AND (
    OLD.is_medical   IS DISTINCT FROM NEW.is_medical
    OR OLD.needs_review IS DISTINCT FROM NEW.needs_review
  )
)
EXECUTE FUNCTION public.create_expense_on_medical_confirmation();

-- ── 2. review_feed_groups: the queue is now everything awaiting a decision ───
--
-- Previously the feed required `is_medical IS TRUE OR classification_reason =
-- 'possible_otc'`, while the nav badge counted plain `needs_review = true`.
-- Two different definitions of "needs review", so any row satisfying one but
-- not the other produced a badge counting work the queue could not show — a
-- dead end the founder hit twice.
--
-- The lane no longer reads is_medical, which since this migration means only
-- "the classifier saw a medical signal", not "medical". It reads the
-- classification reason instead, which is what actually distinguishes the two
-- queues.
DROP FUNCTION IF EXISTS public.review_feed_groups(INTEGER);

CREATE FUNCTION public.review_feed_groups(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  merchant_key          TEXT,
  display_name          TEXT,
  txn_count             BIGINT,
  total_amount          NUMERIC,
  earliest_date         DATE,
  latest_date           DATE,
  explanation           TEXT,
  merchant_entity_id    TEXT,
  mcc                   TEXT,
  lane                  TEXT,
  single_transaction_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description))) AS merchant_key,
    (ARRAY_AGG(COALESCE(t.vendor, t.description) ORDER BY t.transaction_date DESC))[1] AS display_name,
    COUNT(*)                AS txn_count,
    SUM(t.amount)           AS total_amount,
    MIN(t.transaction_date) AS earliest_date,
    MAX(t.transaction_date) AS latest_date,
    (ARRAY_AGG(t.classification_explanation ORDER BY t.transaction_date DESC)
       FILTER (WHERE t.classification_explanation IS NOT NULL))[1] AS explanation,
    CASE WHEN COUNT(DISTINCT t.merchant_entity_id) = 1
         THEN MIN(t.merchant_entity_id) END AS merchant_entity_id,
    CASE WHEN COUNT(DISTINCT t.merchant_category_code) = 1
         THEN MIN(t.merchant_category_code) END AS mcc,
    CASE WHEN t.classification_reason = 'possible_otc'
         THEN 'possible_otc' ELSE 'medical' END AS lane,
    -- MIN()/MAX() have no aggregate defined for uuid; ARRAY_AGG works for any
    -- type and, guarded by the COUNT(*) = 1 check, always has exactly one
    -- element when it matters.
    CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(t.id))[1] END AS single_transaction_id
  FROM public.transactions t
  WHERE t.user_id = auth.uid()
    AND t.needs_review IS TRUE
    -- COALESCE, not `<> 'ignored'`: a NULL status makes that comparison NULL,
    -- which drops the row from the queue while the badge still counts it.
    AND COALESCE(t.reconciliation_status, '') <> 'ignored'
    AND t.split_parent_id IS NULL
  GROUP BY 1, (CASE WHEN t.classification_reason = 'possible_otc'
                    THEN 'possible_otc' ELSE 'medical' END)
  ORDER BY (CASE WHEN t.classification_reason = 'possible_otc'
                 THEN 'possible_otc' ELSE 'medical' END) DESC,
           COUNT(*) DESC, SUM(t.amount) DESC
  LIMIT p_limit;
$$;

-- ── 3. bulk_review_merchant: lane scoping follows the same reason column ─────
CREATE OR REPLACE FUNCTION public.bulk_review_merchant(
  p_merchant_key TEXT,
  p_is_medical   BOOLEAN,
  p_lane         TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count   INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.transactions t
  SET is_medical = p_is_medical,
      needs_review = FALSE,
      category = CASE WHEN p_is_medical THEN 'medical' ELSE t.category END,
      reconciliation_status = CASE
        WHEN p_is_medical THEN t.reconciliation_status ELSE 'ignored' END,
      classification_reason = 'user',
      classification_explanation = CASE
        WHEN p_is_medical THEN 'You confirmed this as a medical expense.'
        ELSE 'You marked this as not medical.' END,
      classification_confidence = 1.0,
      updated_at = now()
  WHERE t.user_id = v_user_id
    AND t.needs_review IS TRUE
    AND COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description)))
        = p_merchant_key
    AND (
      p_lane IS NULL
      OR (p_lane = 'possible_otc' AND t.classification_reason = 'possible_otc')
      OR (p_lane = 'medical' AND t.classification_reason IS DISTINCT FROM 'possible_otc')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 4. Decide a specific set of transactions ────────────────────────────────
--
-- The review feed decides a whole merchant at once. The expenses list needs to
-- decide exactly the rows the user ticked, which may be several merchants and
-- may be a subset of one. Same stamping, so both routes leave identical
-- provenance behind.
CREATE OR REPLACE FUNCTION public.decide_transactions(
  p_transaction_ids UUID[],
  p_is_medical      BOOLEAN
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count   INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_transaction_ids IS NULL OR array_length(p_transaction_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.transactions t
  SET is_medical = p_is_medical,
      needs_review = FALSE,
      category = CASE WHEN p_is_medical THEN 'medical' ELSE t.category END,
      -- Marking something not medical files it away; confirming it medical
      -- leaves reconciliation to the expense trigger, which sets
      -- 'linked_to_invoice'.
      reconciliation_status = CASE
        WHEN p_is_medical THEN t.reconciliation_status ELSE 'ignored' END,
      classification_reason = 'user',
      classification_explanation = CASE
        WHEN p_is_medical THEN 'You confirmed this as a medical expense.'
        ELSE 'You marked this as not medical.' END,
      classification_confidence = 1.0,
      updated_at = now()
  WHERE t.user_id = v_user_id
    AND t.id = ANY(p_transaction_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 5. Backfill: rescue every already-confirmed transaction ─────────────────
--
-- These are the rows the old design stranded — confirmed medical, no expense,
-- and no route to one. Runs as the migration (definer rights), so RLS is not in
-- play; every insert takes its user_id from the transaction it came from.
--
-- Idempotent by construction: NOT EXISTS against invoices.source_transaction_id
-- and invoice_id IS NULL mean a re-run finds nothing to do.
WITH candidates AS (
  SELECT
    t.id,
    t.user_id,
    COALESCE(NULLIF(t.vendor, ''), t.description) AS vendor,
    t.amount,
    t.transaction_date,
    t.plaid_transaction_id,
    COALESCE(pa.is_hsa, false) AS is_hsa
  FROM public.transactions t
  LEFT JOIN public.plaid_accounts pa
    ON pa.id = t.plaid_account_id
   AND pa.user_id = t.user_id
  WHERE t.is_medical IS TRUE
    AND t.needs_review IS NOT TRUE
    AND t.invoice_id IS NULL
    AND COALESCE(t.is_transfer, false) IS FALSE
    AND COALESCE(t.is_split, false) IS FALSE
    AND t.split_parent_id IS NULL
    AND COALESCE(t.reconciliation_status, '') <> 'ignored'
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i WHERE i.source_transaction_id = t.id
    )
), inserted AS (
  INSERT INTO public.invoices (
    user_id, vendor, amount, date, category,
    eligibility_state, documentation_state, claim_state,
    amount_paid, reimbursable_amount,
    source_transaction_id, source_plaid_transaction_id, notes
  )
  -- Explicit casts: unlike the VALUES form in the trigger above, INSERT ...
  -- SELECT does not coerce a bare string literal into its enum column.
  SELECT
    c.user_id, c.vendor, c.amount, c.transaction_date, 'Medical',
    'unknown'::expense_eligibility_state,
    'none'::expense_documentation_state,
    (CASE WHEN c.is_hsa THEN 'not_reimbursable' ELSE 'unclaimed' END)::expense_claim_state,
    c.amount, c.amount,
    c.id, c.plaid_transaction_id,
    'Created when this transaction was confirmed as medical.'
  FROM candidates c
  RETURNING id, source_transaction_id
)
UPDATE public.transactions t
   SET invoice_id            = i.id,
       reconciliation_status = 'linked_to_invoice',
       updated_at            = now()
  FROM inserted i
 WHERE t.id = i.source_transaction_id;

-- ── 6. Repair the back-link on expenses that already exist ──────────────────
--
-- Found on the founder's own account 2026-09-06: six transactions carried a
-- valid invoice_id, and the matching expense existed, but reconciliation_status
-- still read 'unlinked' — so every one of them displayed "Needs Linking" while
-- being fully linked. autoCaptureExpenses wrote both fields in a single update,
-- so the likely cause is a later write that reset the status without clearing
-- the id (handleIgnore and handleAddToReviewQueue both wrote
-- reconciliation_status on its own, which this change also stops).
--
-- 'ignored' is left alone: that is an explicit decision by the user, not drift.
UPDATE public.transactions t
   SET reconciliation_status = 'linked_to_invoice',
       updated_at            = now()
 WHERE t.invoice_id IS NOT NULL
   AND COALESCE(t.reconciliation_status, '') NOT IN ('linked_to_invoice', 'ignored')
   AND COALESCE(t.is_transfer, false) IS FALSE
   AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = t.invoice_id);

DO $$
DECLARE v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM public.transactions t
  WHERE t.is_medical IS TRUE
    AND t.needs_review IS NOT TRUE
    AND t.invoice_id IS NULL
    AND COALESCE(t.is_transfer, false) IS FALSE
    AND COALESCE(t.is_split, false) IS FALSE
    AND COALESCE(t.reconciliation_status, '') <> 'ignored';
  RAISE NOTICE 'Confirmed-medical transactions still without an expense after backfill: %', v_remaining;
END $$;
