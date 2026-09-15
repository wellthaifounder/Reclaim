-- docs/TRANSACTION_REVIEW_SPEC.md D10 — "Queue order is most money first."
--
-- review_feed_groups (20260906120000_approval_creates_expense.sql) orders
-- each lane by COUNT(*) DESC, SUM(amount) DESC -- transaction count first,
-- dollars second. Most people never finish the queue in one sitting, so
-- whatever a group's position is decides what got captured before they
-- stopped. Count-first optimises for rows-cleared, a number nobody asked
-- for; a $9 four-transaction coffee habit was outranking a single $900
-- hospital bill. Swapping the two puts the bill first.
--
-- CREATE OR REPLACE only, no schema change: copied verbatim from the current
-- definition with only the ORDER BY's two terms swapped. Lane ordering
-- (medical before possible_otc) is untouched -- D10 is about ordering
-- within a lane, not between the two.

CREATE OR REPLACE FUNCTION public.review_feed_groups(p_limit INTEGER DEFAULT 50)
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
           SUM(t.amount) DESC, COUNT(*) DESC
  LIMIT p_limit;
$$;
