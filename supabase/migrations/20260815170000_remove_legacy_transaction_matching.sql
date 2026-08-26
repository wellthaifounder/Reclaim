-- Remove transaction-to-bill match suggestions.
--
-- This is the "confirm this match?" flow: the sync guessed which uploaded bill
-- a bank transaction belonged to and asked the user to confirm. It is not part
-- of the bank-sync-first product. Bidirectional matching (a document finding
-- its own transaction) is explicitly deferred to v1.1 in
-- .claude/plans/bank-sync-workflow-spec.md, and manual linking covers the
-- receipt-first case in v1.
--
-- Note for anyone reading the history: 20260815140000 repaired this trigger,
-- which had never fired because it compared a 0..100 confidence column against
-- 0.7/0.9 thresholds. That repair is undone here. The feature was fixed and
-- then removed one commit apart because the defect was found before the
-- decision to drop the feature; the fix is not worth keeping just because it
-- was made.
--
-- What is NOT removed: manual transaction linking (payment_transactions and
-- LinkTransactionDialog). That is a different, still-current path where the
-- user picks the bill themselves.

DROP TRIGGER IF EXISTS trg_inbox_confirm_match ON public.transaction_invoice_suggestions;
DROP FUNCTION IF EXISTS public.generate_match_inbox_item();

-- Retire any confirm_match items already queued, so nothing renders against a
-- table that is about to disappear. Marked expired rather than deleted: these
-- rows are the user's inbox history.
UPDATE public.inbox_items
SET status = 'expired', acted_at = now()
WHERE item_type = 'confirm_match'
  AND status = 'pending';

-- Only ever written, never read by application code — the trigger above was
-- its sole consumer, and the trigger never ran. Nothing to preserve, and the
-- contents were recomputable suggestions rather than user data.
DROP TABLE IF EXISTS public.transaction_invoice_suggestions;
