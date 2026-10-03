-- Notes start blank (SUBSTANTIATE_SPEC S36, amended 2026-10-03).
--
-- Notes is the person's box now, editable in the Substantiate dialog. Every
-- expense created from a bank transaction arrived with the app's own sentence
-- in it -- "Created when this transaction was confirmed as medical." -- and
-- older ones with "Auto-captured from Plaid (...)." from code since removed.
-- That reads as something the person wrote, and leaves them deleting our text
-- before typing their own. Where the expense came from is already recorded in
-- source_transaction_id / source_plaid_transaction_id.
--
-- 1. The confirmation trigger stops writing a note. The body is otherwise
--    byte-for-byte the production definition (checked 2026-10-03), which is
--    still the one 20260906120000_approval_creates_expense.sql created.
-- 2. The app's own sentences are cleared from existing expenses. Exact text
--    only, so nothing a person typed is touched.

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
    source_plaid_transaction_id
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
    NEW.plaid_transaction_id
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

UPDATE public.invoices
   SET notes = NULL
 WHERE notes = 'Created when this transaction was confirmed as medical.'
    OR notes ~ '^Auto-captured from Plaid \([^)]*\)\.$';
