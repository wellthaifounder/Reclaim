-- Workstream D5 — the substantiation step.
--
-- From the workflow spec, Step 2: documentation, date(s) of service, patient,
-- tags and the reimbursable amount, resolved together. The gates from D2-D4
-- already report eligibility; this adds the things the user actually supplies.
--
-- Four pieces here.
--
-- 1. TAGS. The spec's organisation model is "tags + rich filters + saved views
--    + search. No folder tree." Retrieval under stress is the real job --
--    "everything for Maya in 2025 that isn't reimbursed yet" is a filter, not
--    a folder, and a single hierarchy would force that query to be a misfile.
--
-- 2. A SERVICE DATE RANGE, not an arbitrary list. The spec asks for "date(s)
--    of service" on one payment. The real case is a stay or a course of
--    treatment -- "March 3 to March 7" -- which a range expresses exactly. A
--    genuine list of unrelated dates on one payment is the spec's own bundled-
--    payment example, and that is what expense splitting (B3) is for: those
--    parts often belong to different patients and different tax years, which a
--    single expense cannot represent however many dates it carries. Gates keep
--    keying on the earliest date, which is the strictest test against the
--    establishment cliff.
--
-- 3. A CAP ON THE REIMBURSABLE AMOUNT. The spec says this is "editable
--    downward" -- for an insurance refund arriving later, say. Nothing enforced
--    that, so it could be set ABOVE what was actually paid, and the claim would
--    have exceeded the spending with no warning anywhere.
--
-- 4. A COMPLETENESS REPORT, so the screen can say what is still missing rather
--    than leaving the user to infer it from an inactive button.

-- ── 1. Tags ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (BTRIM(name) <> '' AND LENGTH(name) <= 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive: "Dental" and "dental" are one tag, or the filter the whole
-- feature exists for silently returns half the expenses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_unique_name
  ON public.tags (user_id, LOWER(BTRIM(name)));

CREATE TABLE IF NOT EXISTS public.expense_tags (
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_tags_tag ON public.expense_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_expense_tags_user ON public.expense_tags (user_id);

COMMENT ON TABLE public.tags IS
  'Workstream D5: free-form, multi-axis labels. Deliberately not a folder tree
   -- one expense belongs to many tags, and retrieval is a filter.';

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tags" ON public.tags;
CREATE POLICY "Users can view their own tags"
  ON public.tags FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own tags" ON public.tags;
CREATE POLICY "Users can insert their own tags"
  ON public.tags FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own tags" ON public.tags;
CREATE POLICY "Users can update their own tags"
  ON public.tags FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own tags" ON public.tags;
CREATE POLICY "Users can delete their own tags"
  ON public.tags FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own expense tags" ON public.expense_tags;
CREATE POLICY "Users can view their own expense tags"
  ON public.expense_tags FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own expense tags" ON public.expense_tags;
CREATE POLICY "Users can insert their own expense tags"
  ON public.expense_tags FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own expense tags" ON public.expense_tags;
CREATE POLICY "Users can delete their own expense tags"
  ON public.expense_tags FOR DELETE USING (auth.uid() = user_id);

-- ── 2. Service date range ─────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS service_date_end DATE;

COMMENT ON COLUMN public.invoices.service_date_end IS
  'Workstream D5: last day of care when this payment covers a stay or a course
   of treatment. NULL means a single day. The gates read service_date, the
   earliest day, which is the strictest test against the establishment cliff.';

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_service_date_range_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_service_date_range_check
  CHECK (service_date_end IS NULL
         OR service_date IS NULL
         OR service_date_end >= service_date);

-- ── 3. The reimbursable amount cannot exceed what was paid ────────────────
-- Clamp first: a constraint added over violating rows would fail the migration
-- outright, and the clamp is the correct value anyway.

UPDATE public.invoices
   SET reimbursable_amount = amount_paid
 WHERE amount_paid IS NOT NULL
   AND reimbursable_amount IS NOT NULL
   AND reimbursable_amount > amount_paid + 0.005;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_reimbursable_within_paid;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_reimbursable_within_paid
  CHECK (
    reimbursable_amount IS NULL
    OR amount_paid IS NULL
    -- Half-cent tolerance for binary rounding, matching the split-total
    -- trigger. Far below anything a user could type.
    OR (reimbursable_amount >= 0 AND reimbursable_amount <= amount_paid + 0.005)
  );

COMMENT ON CONSTRAINT invoices_reimbursable_within_paid ON public.invoices IS
  'Workstream D5: the claim can never exceed the spend. Editable downward only
   -- an insurance refund reduces what is reimbursable, nothing raises it.';

-- ── 4. What is still missing ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expense_substantiation_status(p_invoice_id UUID)
RETURNS TABLE (
  is_complete       BOOLEAN,
  missing           TEXT[],
  document_count    INTEGER,
  has_service_date  BOOLEAN,
  has_patient       BOOLEAN,
  blocking_gate     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rec     RECORD;
  v_docs    INTEGER;
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_gate    TEXT;
BEGIN
  SELECT i.user_id, i.service_date, i.patient_id, i.eligibility_state,
         i.ineligible_reason
    INTO v_rec
    FROM invoices i WHERE i.id = p_invoice_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_rec.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COUNT(*) INTO v_docs FROM receipts r WHERE r.invoice_id = p_invoice_id;

  -- Phrased as what the IRS would want to see in an audit, in the order the
  -- user can act on. Not blocking anything -- the spec is explicit that the
  -- documentation note "explains what the IRS would want without blocking
  -- anything else".
  IF v_docs = 0 THEN
    v_missing := array_append(v_missing, 'a receipt or itemised statement');
  END IF;
  IF v_rec.service_date IS NULL THEN
    v_missing := array_append(v_missing, 'the date the care happened');
  END IF;
  IF v_rec.patient_id IS NULL THEN
    v_missing := array_append(v_missing, 'who the care was for');
  END IF;

  IF v_rec.eligibility_state = 'ineligible' THEN
    v_gate := v_rec.ineligible_reason;
  ELSIF v_rec.eligibility_state = 'conditional' THEN
    v_gate := 'needs_letter_of_medical_necessity';
  END IF;

  RETURN QUERY SELECT
    (ARRAY_LENGTH(v_missing, 1) IS NULL AND v_gate IS NULL),
    v_missing,
    v_docs,
    (v_rec.service_date IS NOT NULL),
    (v_rec.patient_id IS NOT NULL),
    v_gate;
END;
$fn$;

COMMENT ON FUNCTION public.expense_substantiation_status(UUID) IS
  'Workstream D5: what this expense still needs before it can be claimed.
   Reported so the screen can say it, rather than leaving the user to infer it
   from a disabled button.';

GRANT EXECUTE ON FUNCTION public.expense_substantiation_status(UUID) TO authenticated;
