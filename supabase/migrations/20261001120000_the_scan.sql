-- Substantiate slice 3a: the scan (SUBSTANTIATE_SPEC S7-S12, S18, S20).
--
-- Until now the dialog read the first image of an upload, showed what it saw,
-- and threw it away: nothing was kept, a PDF was never read, and the
-- IRS-category check (classify-expense) read receipt_ocr_data, which only the
-- inbound-email pipeline ever wrote. The scan now runs on every attach, keeps
-- what it reads with the DOCUMENT, and fills the expense's gaps -- never
-- anything a person entered (S9).
--
-- ── 1. What a scan reads is kept with the document (S10, S11) ─────────────
-- One row per document. A rescan replaces it; a document reused on a second
-- expense fills that expense from the same row without a second scan.

ALTER TABLE public.receipt_ocr_data
  ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'read'
    CHECK (scan_status IN ('read', 'unreadable')),
  ADD COLUMN IF NOT EXISTS extracted_service_date_end DATE,
  ADD COLUMN IF NOT EXISTS extracted_patient TEXT,
  ADD COLUMN IF NOT EXISTS extracted_document_type TEXT,
  ADD COLUMN IF NOT EXISTS extracted_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.receipt_ocr_data.scan_status IS
  'read, or unreadable: the document stays attached and is marked "Couldn''t read this" with Scan again beside it (S8).';
COMMENT ON COLUMN public.receipt_ocr_data.extracted_service_date IS
  'The FIRST date of care. Until 2026-10-01 the scanner was told to use the latest date of a range, so a hospital stay that began before the HSA opened passed the timing check on its last day (S10).';
COMMENT ON COLUMN public.receipt_ocr_data.extracted_service_date_end IS
  'The last date of care, when the document shows a range. NULL for a single day.';
COMMENT ON COLUMN public.receipt_ocr_data.extracted_patient IS
  'Who the document says the care was for, "First Last".';
COMMENT ON COLUMN public.receipt_ocr_data.extracted_document_type IS
  'What the scan thinks the document is, from the receipts.document_type list.';
COMMENT ON COLUMN public.receipt_ocr_data.extracted_items IS
  'What was bought or done, as short strings. Empty for a bare card slip, which is how the scan tells one from an itemised receipt (S28).';

-- Keep the newest row where a document was ever read twice, so the unique
-- index below can be built.
DELETE FROM public.receipt_ocr_data a
 USING public.receipt_ocr_data b
 WHERE a.receipt_id = b.receipt_id
   AND (a.processed_at, a.id) < (b.processed_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_ocr_data_one_per_receipt
  ON public.receipt_ocr_data (receipt_id);

-- The policies reached the owner through receipts.invoice_id, the legacy
-- "uploaded for" column. A document uploaded on the Documents page has none,
-- so it could never be scanned. The owner is on the document itself.
DROP POLICY IF EXISTS "Users can view OCR data for their receipts" ON public.receipt_ocr_data;
DROP POLICY IF EXISTS "Users can insert OCR data for their receipts" ON public.receipt_ocr_data;
DROP POLICY IF EXISTS "Users can update OCR data for their receipts" ON public.receipt_ocr_data;
DROP POLICY IF EXISTS "Users can delete OCR data for their receipts" ON public.receipt_ocr_data;

CREATE POLICY "Users can view OCR data for their receipts"
  ON public.receipt_ocr_data FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.receipts r
                  WHERE r.id = receipt_ocr_data.receipt_id
                    AND r.user_id = auth.uid()));

CREATE POLICY "Users can insert OCR data for their receipts"
  ON public.receipt_ocr_data FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.receipts r
                       WHERE r.id = receipt_ocr_data.receipt_id
                         AND r.user_id = auth.uid()));

CREATE POLICY "Users can update OCR data for their receipts"
  ON public.receipt_ocr_data FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.receipts r
                  WHERE r.id = receipt_ocr_data.receipt_id
                    AND r.user_id = auth.uid()));

CREATE POLICY "Users can delete OCR data for their receipts"
  ON public.receipt_ocr_data FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.receipts r
                  WHERE r.id = receipt_ocr_data.receipt_id
                    AND r.user_id = auth.uid()));

-- ── 2. The document type: the scan's, unless a person chose one (S10) ─────
-- Every upload from the dialog was hard-coded "receipt", so a letter of
-- medical necessity uploaded there never cleared the expense waiting for it.
-- The scan may now set the type -- but not over a person's choice.
--
-- NULL = nobody chose (the upload default); 'person' = picked in a type
-- dropdown; 'scan' = set by the scan. Existing rows typed as anything but the
-- default came from a dropdown, so they are a person's.

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS document_type_source TEXT
    CHECK (document_type_source IN ('person', 'scan'));

UPDATE public.receipts
   SET document_type_source = 'person'
 WHERE document_type_source IS NULL
   AND document_type IS DISTINCT FROM 'receipt';

-- trg_receipts_lmn fires on INSERT and DELETE only, so a type CHANGED to (or
-- from) a letter of medical necessity recomputed nothing. Now that the scan
-- can make that change, every expense the document backs is re-checked.
CREATE OR REPLACE FUNCTION public.propagate_lmn_type_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ids UUID[];
BEGIN
  IF 'letter_of_medical_necessity' NOT IN (COALESCE(OLD.document_type, ''),
                                           COALESCE(NEW.document_type, '')) THEN
    RETURN NEW;
  END IF;

  SELECT ARRAY_AGG(ri.invoice_id) INTO v_ids
    FROM receipt_invoices ri
   WHERE ri.receipt_id = NEW.id;

  IF v_ids IS NOT NULL THEN
    PERFORM public.recompute_expense_eligibility(NEW.user_id, v_ids);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_receipts_lmn_type ON public.receipts;
CREATE TRIGGER trg_receipts_lmn_type
  AFTER UPDATE OF document_type ON public.receipts
  FOR EACH ROW
  WHEN (OLD.document_type IS DISTINCT FROM NEW.document_type)
  EXECUTE FUNCTION public.propagate_lmn_type_change();

-- ── 3. Who set each field the scan may fill (S9) ──────────────────────────
-- The scan fills blanks and defaults, and never what a person entered. So
-- each fillable field records who last set it:
--
--   NULL                                   -- a default: the bank's text, the
--                                             payment date, "You"
--   {"by":"person","at":...}               -- typed or picked by a person
--   {"by":"scan","receipt_id":...,"at":...} -- read from that document
--
-- "at" is stamped by the database, never the browser, so a later slice can
-- tell a scan that arrived after a person's edit from one that came before.
-- A pre-existing date of care or a patient other than "You" with no source is
-- treated as a person's: there is no telling, so it is not overwritten.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vendor_original TEXT,
  ADD COLUMN IF NOT EXISTS vendor_source JSONB
    CHECK (vendor_source IS NULL OR vendor_source->>'by' IN ('person', 'scan')),
  ADD COLUMN IF NOT EXISTS service_date_source JSONB
    CHECK (service_date_source IS NULL OR service_date_source->>'by' IN ('person', 'scan')),
  ADD COLUMN IF NOT EXISTS patient_source JSONB
    CHECK (patient_source IS NULL OR patient_source->>'by' IN ('person', 'scan'));

COMMENT ON COLUMN public.invoices.vendor_original IS
  'The name as it first arrived -- usually the bank''s text, e.g. "SQ *SMILE DENTAL 8842" -- kept when the scan replaces vendor with the provider''s name (S12). Shown in small print: it is the link back to the statement.';

CREATE OR REPLACE FUNCTION public.stamp_field_sources()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.vendor_source IS NOT NULL
     AND NEW.vendor_source IS DISTINCT FROM OLD.vendor_source THEN
    NEW.vendor_source := NEW.vendor_source || jsonb_build_object('at', now());
  END IF;
  IF NEW.service_date_source IS NOT NULL
     AND NEW.service_date_source IS DISTINCT FROM OLD.service_date_source THEN
    NEW.service_date_source := NEW.service_date_source || jsonb_build_object('at', now());
  END IF;
  IF NEW.patient_source IS NOT NULL
     AND NEW.patient_source IS DISTINCT FROM OLD.patient_source THEN
    NEW.patient_source := NEW.patient_source || jsonb_build_object('at', now());
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_invoices_field_sources ON public.invoices;
CREATE TRIGGER trg_invoices_field_sources
  BEFORE UPDATE OF vendor_source, service_date_source, patient_source ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.stamp_field_sources();

-- ── 4. Who a document names (S20) ─────────────────────────────────────────
-- A family member by full name; the account holder by the name on their
-- profile (their roster row is usually just "Me"); or, failing both, by first
-- name -- but only when exactly one person answers to it, so "Maya Smith" on
-- a bill finds "Maya" on the roster and never guesses between two Sams.
-- NULL means the name is not on the family list.

CREATE OR REPLACE FUNCTION public.match_family_member(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user  UUID := auth.uid();
  v_full  TEXT := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_name, '')), '\s+', ' ', 'g'));
  v_first TEXT;
  v_id    UUID;
BEGIN
  IF v_user IS NULL OR v_full = '' THEN
    RETURN NULL;
  END IF;
  v_first := SPLIT_PART(v_full, ' ', 1);

  SELECT fm.id INTO v_id
    FROM family_members fm
   WHERE fm.user_id = v_user AND fm.is_active
     AND LOWER(REGEXP_REPLACE(BTRIM(fm.name), '\s+', ' ', 'g')) = v_full
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT fm.id INTO v_id
    FROM family_members fm
    JOIN profiles p ON p.id = fm.user_id
   WHERE fm.user_id = v_user AND fm.is_active AND fm.relationship = 'self'
     AND LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p.full_name, '')), '\s+', ' ', 'g')) = v_full;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(x.id))[1] END INTO v_id
    FROM (
      SELECT fm.id
        FROM family_members fm
       WHERE fm.user_id = v_user AND fm.is_active
         AND SPLIT_PART(LOWER(BTRIM(fm.name)), ' ', 1) = v_first
      UNION
      SELECT fm.id
        FROM family_members fm
        JOIN profiles p ON p.id = fm.user_id
       WHERE fm.user_id = v_user AND fm.is_active AND fm.relationship = 'self'
         AND SPLIT_PART(LOWER(BTRIM(COALESCE(p.full_name, ''))), ' ', 1) = v_first
    ) x;
  RETURN v_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.match_family_member(TEXT) TO authenticated;

-- ── 5. Fill the expense's gaps from one document (S9, S12, S18, S20) ──────
-- Called after a scan, and when an already-scanned document is attached to
-- another expense. Fills a field only when it is blank, still the default, or
-- was itself filled by THIS document (a rescan) or by one no longer attached.
-- Anything a person set is left alone; a later slice asks when they disagree.
-- Never touches what is claimed (S14). Returns the fields it changed.
--
-- Invoker rights: row-level security decides what the caller may change.

CREATE OR REPLACE FUNCTION public.apply_document_scan(
  p_invoice_id UUID,
  p_receipt_id UUID
)
RETURNS TEXT[]
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inv      invoices%ROWTYPE;
  v_scan     receipt_ocr_data%ROWTYPE;
  v_self     UUID;
  v_match    UUID;
  v_stamp    JSONB := jsonb_build_object('by', 'scan', 'receipt_id', p_receipt_id);
  v_filled   TEXT[] := ARRAY[]::TEXT[];
  v_start    DATE;
  v_end      DATE;
  v_vendor   TEXT;
  -- What the row becomes; written once at the end so the gates run once.
  n_vendor          TEXT;
  n_vendor_original TEXT;
  n_vendor_source   JSONB;
  n_service_date    DATE;
  n_service_end     DATE;
  n_date_source     JSONB;
  n_patient         UUID;
  n_patient_source  JSONB;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM receipt_invoices ri
                  WHERE ri.invoice_id = p_invoice_id
                    AND ri.receipt_id = p_receipt_id) THEN
    RAISE EXCEPTION 'That document is not attached to this expense';
  END IF;

  -- A request already sent is an immutable record; nothing here changes it.
  IF v_inv.claim_state NOT IN ('unclaimed', 'not_reimbursable') THEN
    RETURN v_filled;
  END IF;

  SELECT * INTO v_scan FROM receipt_ocr_data WHERE receipt_id = p_receipt_id;
  IF v_scan.id IS NULL OR v_scan.scan_status <> 'read' THEN
    RETURN v_filled;
  END IF;

  n_vendor          := v_inv.vendor;
  n_vendor_original := v_inv.vendor_original;
  n_vendor_source   := v_inv.vendor_source;
  n_service_date    := v_inv.service_date;
  n_service_end     := v_inv.service_date_end;
  n_date_source     := v_inv.service_date_source;
  n_patient         := v_inv.patient_id;
  n_patient_source  := v_inv.patient_source;

  -- Date of care (S18). A blank is the payment-date pre-fill. A date in the
  -- future is a misread, not care, so it fills nothing.
  v_start := v_scan.extracted_service_date;
  v_end   := v_scan.extracted_service_date_end;
  IF v_start IS NOT NULL AND v_start <= CURRENT_DATE
     AND (v_inv.service_date IS NULL
          OR public.scan_may_refill(v_inv.service_date_source, p_invoice_id, p_receipt_id)) THEN
    IF v_end IS NULL OR v_end <= v_start OR v_end > CURRENT_DATE THEN
      v_end := NULL;
    END IF;
    IF (v_inv.service_date, v_inv.service_date_end) IS DISTINCT FROM (v_start, v_end) THEN
      n_service_date := v_start;
      n_service_end  := v_end;
      n_date_source  := v_stamp;
      v_filled := array_append(v_filled, 'service_date');
    END IF;
  END IF;

  -- Who it was for (S20). "You" with no source is the default.
  IF NULLIF(BTRIM(v_scan.extracted_patient), '') IS NOT NULL THEN
    SELECT fm.id INTO v_self
      FROM family_members fm
     WHERE fm.user_id = v_inv.user_id AND fm.relationship = 'self';
    v_match := public.match_family_member(v_scan.extracted_patient);
    IF v_match IS NOT NULL
       AND (v_inv.patient_id IS NULL
            OR (v_inv.patient_source IS NULL AND v_inv.patient_id = v_self)
            OR public.scan_may_refill(v_inv.patient_source, p_invoice_id, p_receipt_id)) THEN
      IF v_match IS DISTINCT FROM v_inv.patient_id THEN
        n_patient := v_match;
        n_patient_source := v_stamp;
        v_filled := array_append(v_filled, 'patient');
      ELSIF v_inv.patient_source IS NULL THEN
        -- The document agrees with the default: it is now the document's.
        n_patient_source := v_stamp;
      END IF;
    END IF;
  END IF;

  -- The provider's name (S12). Only over text that came with the payment --
  -- the bank's, or an emailed receipt's -- never a name someone typed, and
  -- never a mileage log, whose name describes the trip.
  v_vendor := NULLIF(BTRIM(v_scan.extracted_vendor), '');
  IF v_vendor IS NOT NULL AND v_inv.mileage_miles IS NULL
     AND ((v_inv.vendor_source IS NULL
           AND (v_inv.source_transaction_id IS NOT NULL
                OR v_inv.source_plaid_transaction_id IS NOT NULL
                OR v_inv.source = 'email'))
          OR public.scan_may_refill(v_inv.vendor_source, p_invoice_id, p_receipt_id))
     AND v_vendor IS DISTINCT FROM v_inv.vendor THEN
    n_vendor_original := COALESCE(v_inv.vendor_original, v_inv.vendor);
    n_vendor          := v_vendor;
    n_vendor_source   := v_stamp;
    v_filled := array_append(v_filled, 'vendor');
  END IF;

  IF (n_vendor, n_vendor_original, n_vendor_source, n_service_date, n_service_end,
      n_date_source, n_patient, n_patient_source)
     IS DISTINCT FROM
     (v_inv.vendor, v_inv.vendor_original, v_inv.vendor_source, v_inv.service_date,
      v_inv.service_date_end, v_inv.service_date_source, v_inv.patient_id,
      v_inv.patient_source) THEN
    UPDATE invoices
       SET vendor              = n_vendor,
           vendor_original     = n_vendor_original,
           vendor_source       = n_vendor_source,
           service_date        = n_service_date,
           service_date_end    = n_service_end,
           service_date_source = n_date_source,
           patient_id          = n_patient,
           patient_source      = n_patient_source
     WHERE id = p_invoice_id;
  END IF;

  RETURN v_filled;
END;
$fn$;

-- A value the scan put there may be replaced by a scan again: by a rescan of
-- the same document, or by any document once the one it came from has been
-- removed from this expense -- a value from a document that no longer backs
-- the expense is not anyone's decision.
CREATE OR REPLACE FUNCTION public.scan_may_refill(
  p_source     JSONB,
  p_invoice_id UUID,
  p_receipt_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT p_source IS NOT NULL
     AND p_source->>'by' = 'scan'
     AND ((p_source->>'receipt_id')::UUID = p_receipt_id
          OR NOT EXISTS (SELECT 1 FROM receipt_invoices ri
                          WHERE ri.invoice_id = p_invoice_id
                            AND ri.receipt_id = (p_source->>'receipt_id')::UUID));
$fn$;

GRANT EXECUTE ON FUNCTION public.apply_document_scan(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_may_refill(JSONB, UUID, UUID) TO authenticated;
