-- The expense's own name, apart from its provider (SUBSTANTIATE_SPEC S36).
--
-- Until now an expense was known only by `vendor` -- the bank's text, or the
-- provider a document named (S12). That is who was paid, not what the expense
-- was: three instalments to one orthodontist all read "Smile Dental". A person
-- can now call one "Maya's braces, 2 of 3" without losing who the provider is.
--
-- Blank means "no name of its own": every surface shows the provider instead,
-- and keeps doing so as the provider changes. The Medical Expense Record keeps
-- citing the provider -- the IRS wants who was paid, not a nickname.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS title TEXT
    CHECK (title IS NULL OR (char_length(title) BETWEEN 1 AND 120));

COMMENT ON COLUMN public.invoices.title IS
  'The name the person gave the expense (S36). NULL shows the provider (vendor) instead. Never sent to the IRS record, which cites the provider.';
