-- Let a review-feed group be opened up.
--
-- THE GAP. review_feed_groups() collapses a merchant into one row and exposes
-- `single_transaction_id` only when the group is exactly one transaction. That
-- was deliberate — splitting means picking one specific basket, and a group of
-- five Costco trips has no single basket to split — but it left the UI with
-- nothing to offer a multi-transaction OTC group except a sentence telling the
-- user to go find one of its transactions somewhere else. An instruction where
-- a control belongs.
--
-- This returns the rows behind one group so the UI can list them and act on
-- each individually.
--
-- WHY A FUNCTION AND NOT A CLIENT-SIDE QUERY. The group's identity is a
-- computed expression, COALESCE(merchant_normalized, lower(COALESCE(vendor,
-- description))) — not a plain column, so PostgREST cannot filter on it
-- faithfully, and approximating it with merchant_normalized alone silently
-- drops every row where that generated column is NULL. More importantly the
-- expanded list has to be exactly the set the group counted: if the two
-- predicates ever drift, the row says "5 transactions" and opens to show 4.
-- Sharing the predicate in SQL is the only way that cannot happen.

CREATE OR REPLACE FUNCTION public.review_feed_group_transactions(
  p_merchant_key TEXT,
  p_lane         TEXT DEFAULT NULL,
  p_limit        INTEGER DEFAULT 100
)
RETURNS TABLE (
  id                         UUID,
  transaction_date           DATE,
  amount                     NUMERIC,
  vendor                     TEXT,
  description                TEXT,
  category                   TEXT,
  classification_explanation TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id,
    t.transaction_date,
    t.amount,
    t.vendor,
    t.description,
    t.category,
    t.classification_explanation
  FROM public.transactions t
  WHERE t.user_id = auth.uid()
    -- Everything from here to the lane filter is copied verbatim from
    -- review_feed_groups' WHERE clause. It has to be: this function answers
    -- "what is inside that row", so any difference is a bug by construction.
    AND t.needs_review IS TRUE
    AND (t.is_medical IS TRUE OR t.classification_reason = 'possible_otc')
    AND t.reconciliation_status <> 'ignored'
    AND t.split_parent_id IS NULL
    AND COALESCE(t.merchant_normalized, lower(COALESCE(t.vendor, t.description)))
        = p_merchant_key
    -- review_feed_groups derives lane as
    --   CASE WHEN t.is_medical THEN 'medical' ELSE 'possible_otc' END
    -- and groups by (merchant_key, is_medical), so is_medical alone decides
    -- which row a transaction landed in. Mirrored exactly here.
    --
    -- Note this is NOT spelled the way bulk_review_merchant spells its lane
    -- filter (classification_reason = 'possible_otc'). The two are equivalent
    -- for every row that survives the filter above, but this function's job is
    -- to reproduce the grouping, so it copies the grouping.
    AND (
      p_lane IS NULL
      OR (p_lane = 'medical'      AND t.is_medical IS TRUE)
      OR (p_lane = 'possible_otc' AND t.is_medical IS NOT TRUE)
    )
  ORDER BY t.transaction_date DESC, t.id
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.review_feed_group_transactions(TEXT, TEXT, INTEGER) IS
  'The individual transactions behind one review_feed_groups row. Shares that function''s WHERE clause verbatim so an expanded group always contains exactly what the group row counted. SECURITY INVOKER: RLS on transactions plus the auth.uid() filter scope it to the caller.';

GRANT EXECUTE ON FUNCTION public.review_feed_group_transactions(TEXT, TEXT, INTEGER)
  TO authenticated;
