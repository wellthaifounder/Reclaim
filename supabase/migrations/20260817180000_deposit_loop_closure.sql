-- Workstream E4 — close the loop: the custodian's money lands.
--
-- From the spec: "When the HSA -> checking reimbursement deposit lands,
-- transfer matching identifies it against the open request and prompts the
-- user to confirm. On confirmation, reimbursed_amount is applied and the
-- request closes. Matching should tolerate batched and rounded custodian
-- payments rather than requiring an exact-cent match."
--
-- The matcher that exists today (depositMatcher.ts, Phase 4 W3) has four
-- defects, each measured against the code rather than assumed:
--
--   1. IT RESURRECTS DISMISSED MATCHES. The candidate write is an upsert whose
--      payload includes status:'pending' and whose ON CONFLICT clause UPDATEs.
--      A user who dismisses a wrong match gets it back on the next sync, for
--      ever. Fixed here by ON CONFLICT DO NOTHING: a resolved candidate is a
--      decision the user made, and re-running the scan must never overwrite
--      one.
--
--   2. A DEPOSIT CAN PREDATE THE CLAIM. There is no ordering check at all, only
--      a 90-day window, so a deposit from two months BEFORE a record was
--      generated can be offered as the payment that closed it. A custodian
--      cannot pay a claim that has not been made.
--
--   3. IT NEVER RUNS AGAIN. Matching happens once, over the transactions of
--      the sync that delivered them. Generate a record an hour after the
--      deposit posts and nothing ever re-examines it. This is now a scan over
--      open records x unresolved deposits, callable from the sync, the webhook,
--      and the Substantiation page, and idempotent by construction.
--
--   4. THE MONEY NEVER MOVES. Confirming a match sets claim_state='reimbursed'
--      but leaves invoices.reimbursed_amount at 0 -- so the money model says
--      the user has been reimbursed nothing, and remaining = reimbursable -
--      reimbursed still reads as fully claimable. Closing the loop means the
--      money lands in the ledger, not just in a status.
--
-- WHY THE TOLERANCE BAND IS TIERED RATHER THAN WIDENED. The failure mode of a
-- band that is too wide is not a missed prompt -- it is an expense marked
-- reimbursed that was never paid. That destroys claimable money: the user
-- believes they have been paid, the expense leaves the claimable set, and
-- nothing surfaces it again. So the band widens only as far as corroboration
-- justifies it. An exact match stands on its own; a fee-sized gap has to be
-- backed by a signal that this deposit really did come from the HSA.

-- ── 1. What a candidate now records ───────────────────────────────────────

ALTER TABLE public.reimbursement_match_candidates
  ADD COLUMN IF NOT EXISTS match_group_id UUID,
  ADD COLUMN IF NOT EXISTS amount_gap     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS match_signals  TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.reimbursement_match_candidates.match_group_id IS
  'Workstream E4: set when one deposit was matched against a SET of records --
   a custodian paying several claims as one lump sum. NULL for an ordinary
   one-deposit-one-record match. Confirming any member confirms the group,
   because the halves are only true together.';
COMMENT ON COLUMN public.reimbursement_match_candidates.amount_gap IS
  'Workstream E4: how far the deposit was from the total, in dollars. Shown to
   the user rather than hidden -- "$2.00 less than the record total" is the
   difference between a rounding and a partly denied claim, and only the user
   knows which.';
COMMENT ON COLUMN public.reimbursement_match_candidates.match_signals IS
  'Workstream E4: which corroborating signals fired (hsa_transfer,
   custodian_name, prompt). Drives the explanation in the UI; the confidence
   number alone tells the user nothing they can act on.';

CREATE INDEX IF NOT EXISTS idx_reimbursement_candidates_group
  ON public.reimbursement_match_candidates(match_group_id)
  WHERE match_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reimbursement_candidates_txn
  ON public.reimbursement_match_candidates(transaction_id);

-- ── 2. The scan ───────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because it writes candidates the caller has no INSERT
-- policy for, and because the Plaid webhook runs it with no auth.uid() at all.
-- The ownership check below is what stands in for RLS: an authenticated caller
-- may only ever scan their own deposits.

CREATE OR REPLACE FUNCTION public.match_reimbursement_deposits(
  p_user_id       UUID    DEFAULT NULL,
  p_lookback_days INTEGER DEFAULT 120
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  -- A NULL auth.uid() is the service role -- the Plaid sync and webhook, which
  -- legitimately run this on behalf of any user. Anyone else gets themselves.
  IF v_caller IS NOT NULL AND v_caller <> v_user THEN
    RAISE EXCEPTION 'MATCH_FORBIDDEN: cannot match deposits for another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The custodian the user named on their last claim (E3). A deposit whose
  -- descriptor carries that name is the strongest cheap signal there is, and
  -- it is the reason E3 bothered to remember it.
  SELECT hsa_custodian INTO v_custodian FROM profiles WHERE id = v_user;

  -- First word only: descriptors say "OPTUM BANK HSA DIST", not "Optum Bank".
  -- Short tokens are dropped -- "HSA" from "HSA Bank" would match half of
  -- everything and corroborate nothing.
  v_token := NULLIF(SPLIT_PART(COALESCE(v_custodian, ''), ' ', 1), '');
  IF v_token IS NOT NULL AND LENGTH(v_token) < 5 THEN
    v_token := NULL;
  END IF;

  WITH RECURSIVE
  -- Money IN, on a posted transaction, that is not already spoken for.
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
       -- Workstream C5 already knows what these are, and neither can be a
       -- reimbursement: a card payment settles a balance, a contribution goes
       -- the other way. 'internal' is deliberately NOT excluded -- an HSA the
       -- custodian exposes as a plain savings account pairs as internal, and
       -- that is the coverage gap the spec warns about.
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
       AND sr.status = 'generated'
       AND sr.generated_at >= now() - (p_lookback_days || ' days')::INTERVAL
       AND sr.total_amount > 0
  ),

  -- ── one deposit, one record ──
  --
  -- The widest gap tolerated. Absolute floor of $2 covers rounding; the
  -- percentage term lets a large claim absorb a wire or check fee, capped at
  -- $25 so a big record cannot swallow an unrelated deposit. A $50 record
  -- tolerates $2, not $25.
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
        -- A custodian cannot pay a claim that has not been made. Three days of
        -- grace for posting-date slop, not two months of it.
        ON d.transaction_date >= (r.generated_at::date - 3)
       AND ABS(r.total_amount - d.amount)
             <= GREATEST(2.00, LEAST(25.00, r.total_amount * 0.02))
  ),

  -- ── one deposit, several records ──
  --
  -- Custodians batch. Two claims filed a week apart come back as one transfer,
  -- and today that deposit matches nothing at all. Enumerated to size 3 and
  -- held to the tight $2 band: every extra term is another degree of freedom
  -- to fit a coincidence with, so the batch does not also get the fee band.
  batchable AS MATERIALIZED (
    SELECT id, record_number, total_amount, generated_at
      FROM open_records
     ORDER BY generated_at DESC
     LIMIT 30
  ),
  grow AS (
    -- Cast: total_amount is numeric(12,2) but the running sum below is plain
    -- numeric, and a recursive CTE requires both terms to agree exactly.
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
     -- Only when the deposit explains no single record on its own. Offering
     -- both readings of the same money is how a user ends up confirming two.
     WHERE NOT EXISTS (SELECT 1 FROM singles s WHERE s.txn_id = d.id)
  ),

  -- ── one shape, scored the same way ──
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
                -- Below the 0.50 surfacing floor on its own, deliberately: a
                -- gap this size only becomes a prompt with corroboration.
                ELSE 0.45 END AS base
      FROM singles s
    UNION ALL
    SELECT b.txn_id, rid, b.group_id, b.n,
           b.deposit_amount, b.descriptor,
           b.transfer_kind, b.transaction_date, b.generated_at,
           b.total_amount, b.gap,
           'batch'::TEXT AS tier,
           -- A pair stands alone; a triple needs a signal to reach the floor.
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
  -- The weights are set so that a WEAK signal can never carry a WEAK match
  -- over the 0.50 floor, only strengthen one that already stands. Timing alone
  -- (+0.03) leaves the fee band and the three-record batch below the floor;
  -- only knowing the money came out of the HSA, or seeing the custodian's name
  -- on the deposit, lifts them into view. An earlier draft gave timing +0.05,
  -- which quietly meant "$25 short, but it arrived promptly" was enough to
  -- prompt someone to mark $3,200 reimbursed.
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
         -- What THIS record claims of the deposit, not the whole deposit. On a
         -- batch the two are different numbers and conflating them would
         -- overstate every member.
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
  -- A resolved candidate is a decision the user made. Re-running the scan must
  -- never overwrite one, which is exactly what the previous upsert did.
  ON CONFLICT (transaction_id, substantiation_record_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.match_reimbursement_deposits(UUID, INTEGER) IS
  'Workstream E4: scan unresolved deposits against open substantiation records.
   Idempotent -- safe to call from the Plaid sync, the webhook, and the
   Substantiation page on load, which is what fixes the deposit that arrives
   before the record it pays for.';

GRANT EXECUTE ON FUNCTION public.match_reimbursement_deposits(UUID, INTEGER)
  TO authenticated;

-- ── 3. Confirming ─────────────────────────────────────────────────────────
--
-- Was four sequential writes from the browser with no transaction around them.
-- If the third failed, the record read "reimbursed" while its expenses stayed
-- locked in a claim that no longer existed -- unclaimable, and invisible. One
-- function, one transaction.

CREATE OR REPLACE FUNCTION public.confirm_deposit_match(p_candidate_id UUID)
RETURNS TABLE (
  record_id        UUID,
  record_number    TEXT,
  expenses_closed  INTEGER,
  amount_applied   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_now    TIMESTAMPTZ := now();
  v_cand   RECORD;
  v_member RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.id, c.transaction_id, c.match_group_id, c.status
    INTO v_cand
    FROM reimbursement_match_candidates c
   WHERE c.id = p_candidate_id
     AND c.user_id = v_user;

  IF v_cand IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND: that deposit match no longer exists';
  END IF;
  IF v_cand.status <> 'pending' THEN
    RAISE EXCEPTION 'MATCH_RESOLVED: that deposit match was already %',
      v_cand.status;
  END IF;

  -- A batched deposit is only true as a set: the amounts add up to the deposit
  -- together and to nothing apart. Confirming one member confirms the group.
  FOR v_member IN
    SELECT c.id, c.substantiation_record_id AS rec_id
      FROM reimbursement_match_candidates c
     WHERE c.user_id = v_user
       AND c.status = 'pending'
       AND (c.id = p_candidate_id
            OR (v_cand.match_group_id IS NOT NULL
                AND c.match_group_id = v_cand.match_group_id))
  LOOP
    UPDATE reimbursement_match_candidates
       SET status = 'confirmed', resolved_at = v_now
     WHERE id = v_member.id;

    -- The money lands in the ledger, not just in a status. Capped at what the
    -- expense could ever ask for, and accumulated rather than assigned, so a
    -- second reimbursement against a partly paid expense cannot exceed it.
    --
    -- A rounding shortfall is absorbed here rather than left behind: the user
    -- has just said this deposit closed the claim, and leaving $1.40 of
    -- "remaining" on an expense would put unclaimable dust back into the
    -- claimable set for ever.
    WITH closed AS (
      UPDATE invoices i
         SET reimbursed_amount = LEAST(
               COALESCE(i.reimbursable_amount, i.amount_paid, i.amount),
               COALESCE(i.reimbursed_amount, 0) + sri.amount_at_submission),
             claim_state   = 'reimbursed',
             reimbursed_at = v_now,
             updated_at    = v_now
        FROM substantiation_record_items sri
       WHERE sri.substantiation_record_id = v_member.rec_id
         AND sri.invoice_id = i.id
         AND i.user_id = v_user
      RETURNING sri.amount_at_submission AS applied
    )
    SELECT v_member.rec_id,
           (SELECT sr.record_number FROM substantiation_records sr
             WHERE sr.id = v_member.rec_id),
           COUNT(*)::INTEGER,
           COALESCE(SUM(applied), 0)
      INTO record_id, record_number, expenses_closed, amount_applied
      FROM closed;

    -- Setting the status fires trg_records_propagate_status, which moves the
    -- mirrored record_status the claim lock reads. 'reimbursed' is still not
    -- 'voided', so the expenses stay locked -- correct: a reimbursed expense
    -- must never become claimable again.
    UPDATE substantiation_records
       SET status                    = 'reimbursed',
           reimbursed_at             = v_now,
           reimbursed_transaction_id = v_cand.transaction_id,
           updated_at                = v_now
     WHERE id = v_member.rec_id
       AND user_id = v_user;

    -- Nothing else can still be pending against a record that is now closed,
    -- nor against a deposit that has now been spent.
    UPDATE reimbursement_match_candidates
       SET status = 'dismissed', resolved_at = v_now
     WHERE user_id = v_user
       AND status = 'pending'
       AND (substantiation_record_id = v_member.rec_id
            OR transaction_id = v_cand.transaction_id);

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.confirm_deposit_match(UUID) IS
  'Workstream E4: one atomic close-out. Applies reimbursed_amount, moves every
   member expense to claim_state=''reimbursed'', closes the record, and clears
   competing candidates. Confirms the whole group for a batched deposit.';

GRANT EXECUTE ON FUNCTION public.confirm_deposit_match(UUID) TO authenticated;

-- ── 4. Dismissing ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dismiss_deposit_match(p_candidate_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_group UUID;
  v_count INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT match_group_id INTO v_group
    FROM reimbursement_match_candidates
   WHERE id = p_candidate_id AND user_id = v_user;

  -- Symmetric with confirming: a batch is one claim about one deposit, so
  -- rejecting it rejects the whole reading, not one arbitrary member.
  UPDATE reimbursement_match_candidates
     SET status = 'dismissed', resolved_at = now()
   WHERE user_id = v_user
     AND status = 'pending'
     AND (id = p_candidate_id
          OR (v_group IS NOT NULL AND match_group_id = v_group));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.dismiss_deposit_match(UUID) IS
  'Workstream E4: dismiss a deposit match (and its batch siblings). The scan
   uses ON CONFLICT DO NOTHING, so a dismissal is permanent -- the previous
   upsert-based matcher reinstated dismissed candidates on every sync.';

GRANT EXECUTE ON FUNCTION public.dismiss_deposit_match(UUID) TO authenticated;
