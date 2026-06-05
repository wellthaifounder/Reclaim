-- Phase 2 — Reclaim Capture: MCC reference table
-- Date: 2026-05-21
-- See: docs/PRODUCT_BRIEF.md Phase 2 (Capture)
--
-- Server-side IRS-relevant Merchant Category Code (MCC) lookup for Plaid
-- transaction classification. Reference data — readable by any authenticated
-- user, writable only via migrations (no RLS write policy). The brief is
-- explicit that eligibility rules should live in Supabase so they can be
-- updated without an app release; MCC mappings are the first slice of that.

CREATE TABLE mcc_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  is_medical BOOLEAN NOT NULL DEFAULT false,
  irs_category TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE mcc_codes IS
  'Reclaim: Merchant Category Code reference. Seeded with IRS Pub 502-relevant medical MCCs. Auth users can SELECT; writes only via migrations.';

COMMENT ON COLUMN mcc_codes.is_medical IS
  'Reclaim Phase 2: when true, Plaid transactions with this MCC are classified as medical and seed CAPTURED invoices.';
COMMENT ON COLUMN mcc_codes.irs_category IS
  'Free-text bucket used in Substantiation Records (Phase 4): "Medical Services", "Pharmacy", "Vision", etc.';

CREATE INDEX idx_mcc_codes_is_medical ON mcc_codes(is_medical) WHERE is_medical = true;

ALTER TABLE mcc_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read MCC codes"
  ON mcc_codes
  FOR SELECT
  TO authenticated
  USING (true);

-- ── Seed: IRS Pub 502-relevant medical MCCs ──────────────────────────────
-- Sources: official Visa/Mastercard MCC tables cross-referenced with
-- IRS Pub 502 ("Medical and Dental Expenses").
INSERT INTO mcc_codes (code, description, is_medical, irs_category, notes) VALUES
  ('4119', 'Ambulance Services',                 true, 'Medical Services',    'IRS Pub 502: ambulance qualifies'),
  ('5912', 'Drug Stores and Pharmacies',         true, 'Pharmacy',            'Prescription items qualify; OTC limited (HSA rules per CARES Act §3702)'),
  ('5975', 'Hearing Aids — Sales, Service, Supply', true, 'Medical Equipment','IRS Pub 502: hearing aids qualify'),
  ('5976', 'Orthopedic Goods — Prosthetic Devices', true, 'Medical Equipment','IRS Pub 502: artificial limbs/teeth qualify'),
  ('8011', 'Doctors and Physicians (not elsewhere classified)', true, 'Medical Services', 'Includes office visits, consultations'),
  ('8021', 'Dentists and Orthodontists',         true, 'Dental',              'Includes cleanings, fillings, orthodontia'),
  ('8031', 'Osteopathic Physicians',             true, 'Medical Services',    NULL),
  ('8041', 'Chiropractors',                      true, 'Medical Services',    'IRS Pub 502: chiropractic qualifies'),
  ('8042', 'Optometrists, Ophthalmologists',     true, 'Vision',              'Eye exams and prescription eyewear'),
  ('8043', 'Opticians, Eyeglasses',              true, 'Vision',              'Prescription glasses/contacts qualify'),
  ('8049', 'Podiatrists, Chiropodists',          true, 'Medical Services',    NULL),
  ('8050', 'Nursing and Personal Care Facilities', true, 'Long-Term Care',    'Eligible portion depends on care type'),
  ('8062', 'Hospitals',                          true, 'Medical Services',    'Inpatient and outpatient'),
  ('8071', 'Medical and Dental Laboratories',    true, 'Lab/Imaging',         NULL),
  ('8099', 'Health Practitioners — Medical Services (not elsewhere classified)', true, 'Medical Services', 'Catch-all health practitioners');
