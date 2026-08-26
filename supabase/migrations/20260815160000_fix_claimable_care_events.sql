-- Fix the "HSA Reimbursement Ready" figure on the Ledger page.
--
-- detect_claimable_care_events feeds a banner that tells the user how much
-- they can still claim back. It had two defects, both of which inflated that
-- number, and it is money advice shown on screen.
--
-- Defect 1 — an impossible comparison.
--   `pt.payment_source = 'hsa'` never matched anything. payment_transactions
--   CHECKs that column to ('hsa_direct', 'out_of_pocket', 'unpaid')
--   (20251020161135), so `paid_via_hsa` was always 0 for every user.
--
-- Defect 2 — the real overstatement, which fixing defect 1 alone would NOT
--   have corrected.
--   `oop_claimable` was SUM(i.amount): the full billed amount of every
--   HSA-eligible unreimbursed expense in the care event. It never subtracted
--   what the user had already been reimbursed, and it never excluded expenses
--   paid with the HSA card in the first place. An expense paid on the HSA card
--   is not claimable at all — the money already came out of the HSA — yet it
--   counted toward "claimable" at full value.
--
-- Restated on the money model and facets introduced in 20260814120000:
--   claimable = SUM(reimbursable_amount - reimbursed_amount)
--               over expenses that are eligible and still unclaimed.
--
-- That definition excludes HSA-card expenses for free, since those carry
-- claim_state 'not_reimbursable', and it respects a reimbursable_amount the
-- user has edited down (e.g. after an insurance refund) rather than assuming
-- the whole bill is recoverable.

CREATE OR REPLACE FUNCTION public.detect_claimable_care_events(
  p_user_id   UUID,
  p_threshold NUMERIC DEFAULT 50
)
RETURNS TABLE (
  collection_id            UUID,
  title                    TEXT,
  hsa_eligible_amount      NUMERIC,
  total_paid               NUMERIC,
  paid_via_hsa             NUMERIC,
  oop_claimable            NUMERIC,
  invoice_count            BIGINT,
  unreimbursed_invoice_ids UUID[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id AS collection_id,
    c.title,
    c.hsa_eligible_amount,
    c.total_paid,
    COALESCE(hsa_pay.paid_via_hsa, 0) AS paid_via_hsa,
    COALESCE(oop.oop_claimable, 0)    AS oop_claimable,
    COALESCE(oop.invoice_count, 0)    AS invoice_count,
    COALESCE(oop.unreimbursed_invoice_ids, ARRAY[]::UUID[]) AS unreimbursed_invoice_ids
  FROM public.collections c
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(pt.amount), 0) AS paid_via_hsa
    FROM public.payment_transactions pt
    JOIN public.invoices i ON pt.invoice_id = i.id
    WHERE i.collection_id = c.id
      -- 'hsa_direct', not 'hsa'. See defect 1 above.
      AND pt.payment_source = 'hsa_direct'
  ) hsa_pay ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      SUM(
        GREATEST(
          COALESCE(i.reimbursable_amount, i.amount) - COALESCE(i.reimbursed_amount, 0),
          0
        )
      ) AS oop_claimable,
      COUNT(*) AS invoice_count,
      ARRAY_AGG(i.id) AS unreimbursed_invoice_ids
    FROM public.invoices i
    WHERE i.collection_id = c.id
      AND i.eligibility_state = 'eligible'
      -- 'unclaimed' excludes not_reimbursable (HSA-card paid), reimbursed,
      -- reimbursed_externally, and anything locked into an open request.
      AND i.claim_state = 'unclaimed'
      AND GREATEST(
            COALESCE(i.reimbursable_amount, i.amount) - COALESCE(i.reimbursed_amount, 0),
            0
          ) > 0
  ) oop ON TRUE
  WHERE c.user_id = p_user_id
    AND COALESCE(oop.oop_claimable, 0) >= p_threshold
  ORDER BY COALESCE(oop.oop_claimable, 0) DESC;
$$;

COMMENT ON FUNCTION public.detect_claimable_care_events IS
  'Care events with money still recoverable from the HSA. oop_claimable is
   remaining reimbursable value on eligible, unclaimed expenses — it excludes
   HSA-card-paid expenses and anything already reimbursed or locked into an
   open request.';
