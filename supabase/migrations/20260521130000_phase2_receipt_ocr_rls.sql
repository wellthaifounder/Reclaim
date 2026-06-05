-- Phase 2 — Reclaim Capture: write access for receipt_ocr_data
-- Date: 2026-05-21
-- See: docs/PRODUCT_BRIEF.md (Reclaim v1, Phase 2 — Capture)
--
-- The receipt_ocr_data table already has SELECT RLS ("Users can view OCR data
-- for their receipts") scoped via receipts → invoices.user_id, but no INSERT
-- or UPDATE policies exist. The Phase 2 OCR write-through (BillUploadWizard
-- persisting Gemini's structured extraction after invoice creation) needs
-- both. Scoping matches the existing SELECT policy: a row is the user's iff
-- it joins through receipts → invoices to a row they own.

CREATE POLICY "Users can insert OCR data for their receipts"
  ON receipt_ocr_data
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM receipts r
      JOIN invoices e ON r.invoice_id = e.id
      WHERE r.id = receipt_ocr_data.receipt_id
        AND e.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update OCR data for their receipts"
  ON receipt_ocr_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM receipts r
      JOIN invoices e ON r.invoice_id = e.id
      WHERE r.id = receipt_ocr_data.receipt_id
        AND e.user_id = auth.uid()
    )
  );
