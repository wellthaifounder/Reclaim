-- Bank-Sync Rebuild — Workstream A1/A2: account linkage + sync cursor
-- Date: 2026-08-12
-- See: .claude/plans/bank-sync-workflow-spec.md (source of truth)
--      .claude/plans/bank-sync-implementation-plan.md §A1, §A2, §A3, §A5
--
-- Context: the product is being rebuilt around bank sync as the spine. Three
-- gaps in the existing ingestion layer block that, and all three are fixed
-- here at the schema level:
--
--   1. NO ACCOUNT LINKAGE. Plaid returns `account_id` on every transaction and
--      `/accounts/get` returns full account metadata at link time — both were
--      discarded. Without them we cannot tell an HSA account from checking,
--      which blocks HSA-card handling (spend from the HSA is a distribution,
--      never a reimbursement candidate), transfer detection (card charge vs.
--      the checking payment that settles it), and reimbursement-deposit
--      matching. This migration adds `plaid_accounts` and links transactions.
--
--   2. SIGN DESTROYED ON WRITE. Both ingest paths stored `Math.abs(amount)`,
--      so a debit and a credit are indistinguishable after insert. The deposit
--      matcher only works because it reads the raw Plaid payload before the
--      insert. `signed_amount` preserves Plaid's convention (positive = money
--      leaving the account, negative = money arriving) so credit detection can
--      run against stored rows.
--
--   3. NO CURSOR. Both paths used `/transactions/get` with a date window and
--      no pagination, so removed/modified transactions were never reconciled
--      and large pulls were silently truncated at Plaid's default count of
--      100. `transactions_cursor` backs the move to `/transactions/sync`.
--
-- Nothing here is destructive. Legacy columns keep working; the collapse of
-- the duplicate status axes is Workstream B and lands in a separate migration.

-- ── 1. plaid_accounts ─────────────────────────────────────────────────────
CREATE TABLE public.plaid_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id     UUID NOT NULL REFERENCES public.plaid_connections(id) ON DELETE CASCADE,

  -- Plaid's account identifier. Stable for the life of the Item and unique
  -- across Items, so a plain UNIQUE is safe and gives us a clean upsert target.
  plaid_account_id  TEXT NOT NULL UNIQUE,

  name              TEXT,
  official_name     TEXT,
  mask              TEXT,

  -- Plaid taxonomy: type ∈ depository|credit|loan|investment|brokerage|other
  -- subtype ∈ checking|savings|hsa|credit card|… (see Plaid account schema).
  type              TEXT,
  subtype           TEXT,

  -- HSA identification drives the "substantiate but never reimburse" rule.
  -- Detection is from Plaid's subtype; the override exists because custodian
  -- coverage is uneven — some HSAs surface as `investment`/`brokerage` with no
  -- HSA subtype at all, so the user must be able to correct us.
  is_hsa_detected   BOOLEAN NOT NULL DEFAULT false,
  is_hsa_override   BOOLEAN,
  is_hsa            BOOLEAN GENERATED ALWAYS AS
                      (COALESCE(is_hsa_override, is_hsa_detected)) STORED,

  -- Set false when Plaid stops returning the account (closed/unlinked) rather
  -- than deleting the row, so historical transactions keep their linkage.
  is_active         BOOLEAN NOT NULL DEFAULT true,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plaid_accounts_user       ON public.plaid_accounts(user_id);
CREATE INDEX idx_plaid_accounts_connection ON public.plaid_accounts(connection_id);
CREATE INDEX idx_plaid_accounts_hsa        ON public.plaid_accounts(user_id) WHERE is_hsa;

COMMENT ON TABLE public.plaid_accounts IS
  'Per-account metadata from Plaid /accounts/get. Previously fetched at link time and discarded. Required to distinguish HSA accounts, detect transfers, and match reimbursement deposits.';
COMMENT ON COLUMN public.plaid_accounts.is_hsa IS
  'Generated: user override when set, else Plaid-subtype detection. Transactions on an is_hsa account produce expenses that require substantiation but can never enter a reimbursement request.';

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own plaid accounts"
  ON public.plaid_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own plaid accounts"
  ON public.plaid_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own plaid accounts"
  ON public.plaid_accounts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own plaid accounts"
  ON public.plaid_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- ── 2. transactions: account linkage + signed amount ─────────────────────
ALTER TABLE public.transactions
  ADD COLUMN plaid_account_id UUID REFERENCES public.plaid_accounts(id) ON DELETE SET NULL,
  ADD COLUMN signed_amount    NUMERIC;

CREATE INDEX idx_transactions_plaid_account
  ON public.transactions(plaid_account_id)
  WHERE plaid_account_id IS NOT NULL;

-- Supports transfer detection: find candidate counterparties by user + date +
-- magnitude without scanning the whole table.
CREATE INDEX idx_transactions_transfer_lookup
  ON public.transactions(user_id, transaction_date, amount);

COMMENT ON COLUMN public.transactions.plaid_account_id IS
  'FK to plaid_accounts. NULL for manual and csv_import rows, and for Plaid rows ingested before 2026-08-12 (backfilled on next sync).';
COMMENT ON COLUMN public.transactions.signed_amount IS
  'Plaid sign convention preserved: positive = money out of the account, negative = money into it. `amount` remains absolute for existing consumers. NULL on historical rows where the sign is unrecoverable — the next /transactions/sync pass repopulates them.';

-- ── 3. plaid_connections: cursor + real institution name ─────────────────
ALTER TABLE public.plaid_connections
  ADD COLUMN transactions_cursor TEXT,
  ADD COLUMN institution_id      TEXT,
  ADD COLUMN accounts_synced_at  TIMESTAMPTZ;

-- `institution_name` has been storing Plaid's institution_id since the column
-- was introduced (plaid-exchange-token wrote `accountsData.item.institution_id`
-- into it), so users saw a raw Plaid ID. Move that value to its correct home.
-- The code change that fetches the real display name via /institutions/get_by_id
-- ships alongside this migration; until a connection re-syncs, name == id, which
-- is exactly the current behavior — no regression.
UPDATE public.plaid_connections
   SET institution_id = institution_name
 WHERE institution_id IS NULL
   AND institution_name IS NOT NULL;

COMMENT ON COLUMN public.plaid_connections.transactions_cursor IS
  'Opaque cursor from /transactions/sync. NULL means no successful sync yet; the next run starts from the beginning of available history and pages through has_more.';
COMMENT ON COLUMN public.plaid_connections.institution_id IS
  'Plaid institution_id (e.g. ins_109508). Backfilled from institution_name, which had been storing the id.';
COMMENT ON COLUMN public.plaid_connections.institution_name IS
  'Human-readable institution display name from /institutions/get_by_id. Historically held the institution_id; corrected on next sync.';
COMMENT ON COLUMN public.plaid_connections.accounts_synced_at IS
  'Last time plaid_accounts was refreshed from /accounts/get for this connection.';

-- ── 4. updated_at trigger for plaid_accounts ─────────────────────────────
-- Reuses the existing project-wide helper if present; defines a local one only
-- if it is missing, so this migration runs from an empty schema (CLAUDE.md
-- 2026-05-03 lesson: every migration must be runnable standalone).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

CREATE TRIGGER trg_plaid_accounts_updated_at
  BEFORE UPDATE ON public.plaid_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
