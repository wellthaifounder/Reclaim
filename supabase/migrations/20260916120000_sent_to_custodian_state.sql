-- Spec D30-D33 -- generating a claim is a draft, not a commitment.
--
-- From the spec: "Today, generating the PDF and sending it are the same
-- state, and generating locks -- so the honest workflow of generate -> spot
-- something indefensible -> pull it -> regenerate is blocked by a lock that
-- has not earned its authority yet."
--
-- The machinery already exists and is not rebuilt here: records carry a
-- status, items mirror it, and a partial unique index is what makes the claim
-- lock hold under concurrency (20260817140000, narrowed to claims only by
-- 20260906130000). What was missing is the distinction between MADE THE PDF
-- and SENT IT -- 'generated' has been carrying both meanings at once.
--
-- This migration inserts 'sent' between them. 'generated' now means "exists,
-- nothing committed" for a claim, same as it always has for a record. Only
-- 'sent' -- set once, by the user, when they say they actually mailed or
-- uploaded it -- locks the expenses inside it. Voiding (still internal-only;
-- see 20260818120000) already releases whichever of those states a record was
-- in, so it needs no change.

-- ── 1. The new state ─────────────────────────────────────────────────────

ALTER TABLE public.substantiation_records
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.substantiation_records.sent_at IS
  'Spec D31: when the user told us this claim actually went to their
   custodian. NULL for a draft (never sent) or a record (never sent
   anywhere). This, not generated_at, is when the claim lock actually took
   hold -- see mark_record_sent.';

ALTER TABLE public.substantiation_records
  DROP CONSTRAINT IF EXISTS substantiation_records_status_check;
ALTER TABLE public.substantiation_records
  ADD CONSTRAINT substantiation_records_status_check
  CHECK (status IN ('generated', 'sent', 'reimbursed', 'voided'));

COMMENT ON COLUMN public.substantiation_records.status IS
  '"generated" (a draft -- made, not committed, not locking anything),
   "sent" (spec D31: the user told us it went to their custodian -- the real
   commitment, and what the claim lock keys off), "reimbursed" (a deposit was
   matched and confirmed), "voided" (discarded, or withdrawn after being
   sent). A record (purpose=''record'') only ever reaches ''generated'' or
   ''voided'' -- it has no custodian to send to.';

ALTER TABLE public.substantiation_record_items
  DROP CONSTRAINT IF EXISTS substantiation_record_items_record_status_check;
ALTER TABLE public.substantiation_record_items
  ADD CONSTRAINT substantiation_record_items_record_status_check
  CHECK (record_status IN ('generated', 'sent', 'reimbursed', 'voided'));

-- ── 2. The lock moves from "generated" to "sent" ─────────────────────────
-- Verbatim from 20260906130000's definition with one word changed: the claim
-- lock now keys off ('sent', 'reimbursed') instead of "anything not voided".
-- A draft claim can share an expense with another draft, or with a record --
-- neither has committed to anything yet. Marking one of them sent is what
-- claims the expense, and if a sibling draft already holds it, that is
-- exactly the double-claim this index exists to catch: the UPDATE inside
-- mark_record_sent below fails on it, atomically, the same way a second
-- browser tab generating at the old lock-on-insert always did.

DROP INDEX IF EXISTS public.idx_record_items_one_live_claim;
CREATE UNIQUE INDEX idx_record_items_one_live_claim
  ON public.substantiation_record_items (invoice_id)
  WHERE record_status IN ('sent', 'reimbursed') AND record_purpose = 'claim';

COMMENT ON INDEX public.idx_record_items_one_live_claim IS
  'Spec D30-D31: the claim lock. An expense may sit in at most one SENT or
   reimbursed claim. Any number of drafts (generated) or records may still
   reference it -- neither has committed to anything. Declarative because it
   has to survive concurrency: two tabs marking overlapping drafts sent at
   once is the exact case a counted check misses.';

-- ── 3. Claimable expenses agrees with the lock ───────────────────────────
-- claimable_expenses() has not queried invoices directly since 20260909120000
-- -- it is a thin filter over substantiatable_expenses(), which carries its
-- OWN copy of the "not already claimed" clause in its `claimable` column
-- (single source of truth for both the record-generator's superset and the
-- claim-only picker). That is the copy that actually needs the one-word
-- change; touching claimable_expenses() alone, as an earlier draft of this
-- migration did, left substantiatable_expenses() still keying off "anything
-- not voided" and made a freshly generated DRAFT claim's own expenses vanish
-- from "ready to submit" a moment after generating it -- precisely the
-- appearance of a lock the whole point of D30 is to not have yet. Caught by
-- generating a real draft in the browser and watching the total drop to
-- $0.00, not by reading the SQL.

CREATE OR REPLACE FUNCTION public.substantiatable_expenses()
RETURNS TABLE(
  invoice_id          UUID,
  vendor              TEXT,
  service_date        DATE,
  tax_year            INTEGER,
  category            TEXT,
  patient_name        TEXT,
  full_amount         NUMERIC,
  remaining_amount    NUMERIC,
  claim_state         TEXT,
  claimable           BOOLEAN,
  confirmed_at        TIMESTAMPTZ,
  rule_id             TEXT,
  rule_name           TEXT,
  rule_section_ref    TEXT,
  documentation_state TEXT,
  documents           JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT
    i.id,
    i.vendor,
    i.effective_service_date,
    EXTRACT(YEAR FROM i.effective_service_date)::INT,
    i.category,
    i.patient_name,
    COALESCE(i.reimbursable_amount, i.amount_paid, i.amount),
    GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
             - COALESCE(i.reimbursed_amount, 0), 0),
    i.claim_state::TEXT,
    -- Spec D30-D31: a draft (record_status='generated') no longer counts as
    -- "already claimed". Only a SENT or reimbursed claim does.
    (
      i.claim_state = 'unclaimed'
      AND GREATEST(COALESCE(i.reimbursable_amount, i.amount_paid, i.amount)
                   - COALESCE(i.reimbursed_amount, 0), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM substantiation_record_items sri
         WHERE sri.invoice_id = i.id
           AND sri.record_status IN ('sent', 'reimbursed')
           AND sri.record_purpose = 'claim'
      )
    ),
    i.confirmed_at,
    i.eligibility_basis_rule_id,
    pr.name,
    pr.section_ref,
    i.documentation_state,
    COALESCE(
      (SELECT JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'path', r.file_path,
                  'type', r.document_type,
                  'description', r.description)
                ORDER BY r.uploaded_at)
         FROM receipts r
         JOIN receipt_invoices ri ON ri.receipt_id = r.id
        WHERE ri.invoice_id = i.id),
      '[]'::JSONB
    )
  FROM invoices i
  LEFT JOIN pub_502_rules pr ON pr.id = i.eligibility_basis_rule_id
  WHERE i.user_id = auth.uid()
    AND i.eligibility_state = 'eligible'
    AND i.claim_state <> 'reimbursed_externally'
  ORDER BY i.effective_service_date ASC, i.vendor ASC;
$fn$;

CREATE OR REPLACE FUNCTION public.claimable_expenses()
RETURNS TABLE(
  invoice_id          UUID,
  vendor              TEXT,
  service_date        DATE,
  tax_year            INTEGER,
  category            TEXT,
  patient_name        TEXT,
  remaining_amount    NUMERIC,
  confirmed_at        TIMESTAMPTZ,
  rule_id             TEXT,
  rule_name           TEXT,
  rule_section_ref    TEXT,
  documentation_state TEXT,
  documents           JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT
    s.invoice_id, s.vendor, s.service_date, s.tax_year, s.category,
    s.patient_name, s.remaining_amount, s.confirmed_at, s.rule_id,
    s.rule_name, s.rule_section_ref, s.documentation_state, s.documents
  FROM public.substantiatable_expenses() s
  WHERE s.claimable
  ORDER BY s.service_date ASC, s.vendor ASC;
$fn$;

COMMENT ON FUNCTION public.claimable_expenses() IS
  'Spec D30-D31: eligible, unclaimed, remaining > 0, and not already inside a
   SENT or reimbursed claim. A draft claim over an expense does not remove it
   from this list -- generating a draft is not a commitment. Thin filter over
   substantiatable_expenses(), which is the one place the predicate lives.';

-- ── 4. Deposit matching only chases what was actually sent ───────────────
-- Verbatim from 20260906130000 with the same one-word change. A draft has no
-- custodian who could have paid it; scanning for a deposit against one would
-- offer to close a claim that was never filed.

CREATE OR REPLACE FUNCTION public.match_reimbursement_deposits(p_user_id uuid DEFAULT NULL::uuid, p_lookback_days integer DEFAULT 120)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user      UUID := COALESCE(p_user_id, auth.uid());
  v_caller    UUID := auth.uid();
  v_custodian TEXT;
  v_token     TEXT;
  v_inserted  INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MATCH_NO_USER: no user to match deposits for';
  END IF;
  IF v_caller IS NOT NULL AND v_caller <> v_user THEN
    RAISE EXCEPTION 'MATCH_FORBIDDEN: cannot match deposits for another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT hsa_custodian INTO v_custodian FROM profiles WHERE id = v_user;

  v_token := NULLIF(SPLIT_PART(COALESCE(v_custodian, ''), ' ', 1), '');
  IF v_token IS NOT NULL AND LENGTH(v_token) < 5 THEN
    v_token := NULL;
  END IF;

  WITH RECURSIVE
  deposits AS MATERIALIZED (
    SELECT t.id,
           t.transaction_date,
           ABS(t.signed_amount) AS amount,
           t.transfer_kind,
           COALESCE(t.vendor, t.description) AS descriptor
      FROM transactions t
     WHERE t.user_id = v_user
       AND t.signed_amount < 0
       AND t.transaction_date >= CURRENT_DATE - p_lookback_days
       AND t.is_pending = FALSE
       AND (t.transfer_kind IS NULL
            OR t.transfer_kind NOT IN ('card_payment', 'hsa_contribution'))
       AND NOT EXISTS (
             SELECT 1 FROM substantiation_records sr
              WHERE sr.reimbursed_transaction_id = t.id)
  ),
  open_records AS MATERIALIZED (
    SELECT sr.id, sr.record_number, sr.total_amount, sr.generated_at
      FROM substantiation_records sr
     WHERE sr.user_id = v_user
       AND sr.status = 'sent'
       AND sr.purpose = 'claim'
       AND sr.generated_at >= now() - (p_lookback_days || ' days')::INTERVAL
       AND sr.total_amount > 0
  ),
  singles AS (
    SELECT d.id               AS txn_id,
           r.id               AS record_id,
           d.amount           AS deposit_amount,
           d.descriptor,
           d.transfer_kind,
           d.transaction_date,
           r.generated_at,
           r.total_amount,
           ABS(r.total_amount - d.amount) AS gap
      FROM deposits d
      JOIN open_records r
        ON d.transaction_date >= (r.generated_at::date - 3)
       AND ABS(r.total_amount - d.amount)
             <= GREATEST(2.00, LEAST(25.00, r.total_amount * 0.02))
  ),
  batchable AS MATERIALIZED (
    SELECT id, record_number, total_amount, generated_at
      FROM open_records
     ORDER BY generated_at DESC
     LIMIT 30
  ),
  grow AS (
    SELECT ARRAY[b.id] AS ids, b.id AS max_id, b.total_amount::NUMERIC AS total,
           b.generated_at AS last_generated, 1 AS n
      FROM batchable b
    UNION ALL
    SELECT g.ids || b.id, b.id, g.total + b.total_amount,
           GREATEST(g.last_generated, b.generated_at), g.n + 1
      FROM grow g
      JOIN batchable b ON b.id > g.max_id
     WHERE g.n < 3
  ),
  batches AS MATERIALIZED (
    SELECT gen_random_uuid() AS group_id,
           d.id       AS txn_id,
           g.ids,
           g.n,
           d.amount   AS deposit_amount,
           d.descriptor,
           d.transfer_kind,
           d.transaction_date,
           g.last_generated AS generated_at,
           g.total    AS total_amount,
           ABS(g.total - d.amount) AS gap
      FROM deposits d
      JOIN grow g
        ON g.n >= 2
       AND d.transaction_date >= (g.last_generated::date - 3)
       AND ABS(g.total - d.amount) <= 2.00
     WHERE NOT EXISTS (SELECT 1 FROM singles s WHERE s.txn_id = d.id)
  ),
  combined AS (
    SELECT s.txn_id, s.record_id, NULL::UUID AS group_id, 1 AS n,
           s.deposit_amount, s.descriptor,
           s.transfer_kind, s.transaction_date, s.generated_at,
           s.total_amount, s.gap,
           (CASE WHEN s.gap <= 0.01 THEN 'exact'
                 WHEN s.gap <= 2.00 THEN 'rounded'
                 ELSE 'fee' END)::TEXT AS tier,
           CASE WHEN s.gap <= 0.01 THEN 0.90
                WHEN s.gap <= 2.00 THEN 0.70
                ELSE 0.45 END AS base
      FROM singles s
    UNION ALL
    SELECT b.txn_id, rid, b.group_id, b.n,
           b.deposit_amount, b.descriptor,
           b.transfer_kind, b.transaction_date, b.generated_at,
           b.total_amount, b.gap,
           'batch'::TEXT AS tier,
           CASE WHEN b.n = 2 THEN 0.55 ELSE 0.45 END AS base
      FROM batches b, UNNEST(b.ids) AS rid
  ),
  scored AS (
    SELECT c.*,
           (c.transfer_kind = 'hsa_distribution') AS sig_transfer,
           (v_token IS NOT NULL
            AND c.descriptor IS NOT NULL
            AND STRPOS(UPPER(c.descriptor), UPPER(v_token)) > 0) AS sig_custodian,
           (c.transaction_date <= (c.generated_at::date + 21)) AS sig_prompt
      FROM combined c
  ),
  final AS (
    SELECT s.*,
           LEAST(1.00,
                 s.base
                 + CASE WHEN s.sig_transfer  THEN 0.15 ELSE 0 END
                 + CASE WHEN s.sig_custodian THEN 0.12 ELSE 0 END
                 + CASE WHEN s.sig_prompt    THEN 0.03 ELSE 0 END
           ) AS confidence,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN s.sig_transfer  THEN 'hsa_transfer'   END,
             CASE WHEN s.sig_custodian THEN 'custodian_name' END,
             CASE WHEN s.sig_prompt    THEN 'prompt'         END
           ], NULL) AS signals
      FROM scored s
  )
  INSERT INTO reimbursement_match_candidates
    (user_id, transaction_id, substantiation_record_id, match_amount,
     match_confidence, match_reason, status, match_group_id, amount_gap,
     match_signals)
  SELECT v_user,
         f.txn_id,
         f.record_id,
         r.total_amount,
         f.confidence,
         CASE f.tier
           WHEN 'exact' THEN
             'Exact match: the deposit equals this record''s total to the cent.'
           WHEN 'rounded' THEN
             'Within $' || TO_CHAR(f.gap, 'FM999990.00')
             || ' of this record''s total — custodians often round.'
           WHEN 'fee' THEN
             '$' || TO_CHAR(f.gap, 'FM999990.00')
             || ' short of this record''s total, which is the size of a typical'
             || ' custodian transfer fee. Check the amount before confirming.'
           ELSE
             'One deposit of $' || TO_CHAR(f.deposit_amount, 'FM999999990.00')
             || ' looks like ' || f.n || ' records paid together.'
         END
         || CASE WHEN f.sig_transfer
                 THEN ' The money came out of your HSA.' ELSE '' END
         || CASE WHEN f.sig_custodian
                 THEN ' The deposit is from ' || v_custodian || '.' ELSE '' END,
         'pending',
         f.group_id,
         f.gap,
         f.signals
    FROM final f
    JOIN open_records r ON r.id = f.record_id
   WHERE f.confidence >= 0.50
  ON CONFLICT (transaction_id, substantiation_record_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_reimbursement_deposits(UUID, INTEGER)
  TO authenticated;

-- ── 5. The commitment itself ─────────────────────────────────────────────
-- One action, one transaction, mirroring void_substantiation_record's shape:
-- lock the invoices and flip the record's status together, so a failure
-- partway through can never leave one true without the other. Locking the
-- invoices BEFORE flipping status means that if a sibling draft already holds
-- one of these expenses as SENT, the status UPDATE below fires the mirror
-- trigger, the mirror trigger hits idx_record_items_one_live_claim, and the
-- whole transaction (invoices included) rolls back -- nothing partially sent.

CREATE OR REPLACE FUNCTION public.mark_record_sent(p_record_id UUID)
RETURNS TABLE (
  record_number   TEXT,
  expenses_locked INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_rec  RECORD;
  v_now  TIMESTAMPTZ := now();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT sr.id, sr.status, sr.purpose, sr.record_number
    INTO v_rec
    FROM substantiation_records sr
   WHERE sr.id = p_record_id
     AND sr.user_id = v_user;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'SEND_NOT_FOUND: that record does not exist';
  END IF;

  IF v_rec.purpose <> 'claim' THEN
    RAISE EXCEPTION
      'SEND_NOT_A_CLAIM: % is kept as evidence, not sent to a custodian',
      v_rec.record_number;
  END IF;

  -- Marking sent twice is the same as marking it once -- a double-click or a
  -- retry after a dropped connection must not raise an error at the user.
  IF v_rec.status = 'sent' THEN
    RETURN QUERY SELECT v_rec.record_number, 0;
    RETURN;
  END IF;

  IF v_rec.status <> 'generated' THEN
    RAISE EXCEPTION
      'SEND_WRONG_STATUS: % is % and cannot be marked sent from there',
      v_rec.record_number, v_rec.status;
  END IF;

  WITH locked AS (
    UPDATE invoices i
       SET claim_state          = 'locked_in_request',
           submitted_at         = COALESCE(i.submitted_at, v_now),
           -- First record to lock an invoice owns the back-link, same rule
           -- the browser used to apply at generation time.
           submitted_record_id  = COALESCE(i.submitted_record_id, p_record_id),
           updated_at           = v_now
      FROM substantiation_record_items sri
     WHERE sri.substantiation_record_id = p_record_id
       AND sri.invoice_id = i.id
       AND i.user_id = v_user
       AND i.claim_state = 'unclaimed'
    RETURNING i.id
  )
  SELECT COUNT(*)::INTEGER INTO expenses_locked FROM locked;

  -- Fires trg_records_propagate_status, which mirrors 'sent' onto the items --
  -- and THAT is what the claim lock actually reads. A sibling draft already
  -- holding one of these invoice_ids as sent/reimbursed makes this a unique
  -- violation, which rolls back the invoice lock above along with it.
  UPDATE substantiation_records
     SET status     = 'sent',
         sent_at    = v_now,
         updated_at = v_now
   WHERE id = p_record_id
     AND user_id = v_user;

  record_number := v_rec.record_number;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mark_record_sent(UUID) IS
  'Spec D31: the real commitment. Locks every expense in this claim and moves
   it from draft (generated) to sent. Generating and downloading the packet
   does none of this -- only telling Reclaim it actually went to a custodian
   does.';

GRANT EXECUTE ON FUNCTION public.mark_record_sent(UUID) TO authenticated;
