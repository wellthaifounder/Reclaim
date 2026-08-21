-- Fix: saving a bank transaction failed outright.
--
-- The 2026-08-20 clean-out dropped `inbox_items` along with the rest of the
-- pre-bank-sync surfaces, but left two trigger functions on `transactions`
-- that write to it:
--
--   generate_review_inbox_item          AFTER INSERT on transactions
--   resolve_inbox_on_transaction_update AFTER UPDATE  on transactions
--
-- So every INSERT into `transactions` raised
-- `relation "inbox_items" does not exist` and rolled back, and every UPDATE
-- that linked or reviewed a transaction did the same. In practice: a Plaid
-- sync could not store a single transaction, and marking one medical or
-- non-medical failed. Nothing caught it because the drop migration was never
-- followed by an insert — the tables were empty and stayed empty.
--
-- Found by seeding a transaction by hand while checking the collections drop.
--
-- The inbox itself is not coming back. It was the notification feed for the
-- retired product, and the review queue that replaced it reads
-- `transactions.needs_review` directly, so there is nothing to migrate — only
-- two triggers to remove.

BEGIN;

DROP TRIGGER IF EXISTS trg_inbox_review_transaction ON public.transactions;
DROP TRIGGER IF EXISTS trg_resolve_inbox_on_transaction_update ON public.transactions;

DROP FUNCTION IF EXISTS public.generate_review_inbox_item() CASCADE;
DROP FUNCTION IF EXISTS public.resolve_inbox_on_transaction_update() CASCADE;

-- Four more functions left pointing at tables from the same clean-out. None is
-- attached to a trigger and nothing calls them, so they were not breaking
-- anything — but a function that references a table which no longer exists is
-- a trap for whoever reads this schema next.
DROP FUNCTION IF EXISTS public.calculate_fair_pricing_score(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_provider_review_aggregates() CASCADE;
DROP FUNCTION IF EXISTS public.update_provider_scores() CASCADE;
DROP FUNCTION IF EXISTS public.update_provider_statistics() CASCADE;

-- Guard: prove a transaction can actually be stored now. This is the exact
-- operation that was failing, so it is the one worth asserting. The row is
-- rolled back into nothing by the exception-free path below.
DO $$
DECLARE
  v_user UUID;
  v_id   UUID;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    -- Fresh database with no users yet; nothing to test against, and the
    -- trigger removal above is unconditional anyway.
    RETURN;
  END IF;

  INSERT INTO public.transactions (user_id, transaction_date, amount, description)
  VALUES (v_user, CURRENT_DATE, 1.00, 'migration self-test')
  RETURNING id INTO v_id;

  UPDATE public.transactions SET needs_review = false WHERE id = v_id;

  DELETE FROM public.transactions WHERE id = v_id;
END $$;

COMMIT;
