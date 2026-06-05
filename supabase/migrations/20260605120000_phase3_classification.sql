-- Phase 3 — Reclaim Classification
-- Date: 2026-06-05
-- See: docs/PRODUCT_BRIEF.md §6 (state machine), §7 (Substantiation Record),
--      §18 Phase 3 (items 9–11).
--
-- This migration lays the data foundation for the audit-trail moat: every
-- ELIGIBLE invoice will carry an explicit Pub 502 rule basis + the user's
-- own confirmation timestamp. Substantiation Records (Phase 4) generate
-- IRS-style PDFs straight off this schema.
--
-- Slices:
--   1. `pub_502_rules` — server-side IRS Pub 502 eligibility catalog.
--      Auth users SELECT, writes via migration only.
--   2. `mcc_codes.default_pub_502_rule_id` — link existing MCC seeds to a
--      default Pub 502 rule, so the Plaid auto-capture path can populate
--      classification fields cheaply without a per-transaction AI call.
--   3. `invoices` classification columns — the rule, confidence, reasoning,
--      warnings, classified_at, AND `confirmed_at`. The last column is the
--      Reclaim audit-trail moat.

-- ── 1. pub_502_rules ──────────────────────────────────────────────────────
CREATE TABLE pub_502_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  eligibility_status TEXT NOT NULL
    CHECK (eligibility_status IN ('eligible', 'conditional', 'ineligible')),
  conditions TEXT,
  section_ref TEXT,
  examples TEXT[],
  effective_year INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pub_502_rules IS
  'Reclaim Phase 3: server-side IRS Pub 502 eligibility catalog. Auth users SELECT; writes via migration only. Updatable without app release per brief §4 ("Eligibility rules live server-side, updatable without an app release").';
COMMENT ON COLUMN pub_502_rules.eligibility_status IS
  '"eligible" (always qualifies), "conditional" (qualifies under conditions described in `conditions`), "ineligible" (explicitly disqualified).';
COMMENT ON COLUMN pub_502_rules.examples IS
  'Canonical merchant/vendor examples used by the AI classifier as few-shot context.';

CREATE INDEX idx_pub_502_rules_category ON pub_502_rules(category);

ALTER TABLE pub_502_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read Pub 502 rules"
  ON pub_502_rules
  FOR SELECT
  TO authenticated
  USING (true);

-- ── Pub 502 rule seed (2025 tax year, IRS Publication 502) ───────────────
-- Curated from the most common medical-expense lines users will encounter.
-- Both eligible and explicitly ineligible entries are seeded so the AI
-- classifier can discriminate (the brief calls out user-confirmed eligibility
-- as the audit-trail event; we never want to silently approve something
-- Pub 502 lists as ineligible).
INSERT INTO pub_502_rules
  (id, name, category, eligibility_status, conditions, section_ref, examples, effective_year, notes)
VALUES
  ('acupuncture',           'Acupuncture',                     'Medical',         'eligible',    NULL,                                                                              'Pub 502 — Acupuncture',           NULL,                                                                  2025, NULL),
  ('alcohol-treatment',     'Alcoholism Treatment',            'Mental Health',   'eligible',    'Inpatient or outpatient treatment programs.',                                     'Pub 502 — Alcoholism',            ARRAY['Hazelden','Betty Ford'],                                        2025, NULL),
  ('ambulance',             'Ambulance Services',              'Medical',         'eligible',    NULL,                                                                              'Pub 502 — Ambulance',             ARRAY['Ambulance Service','AMR'],                                      2025, NULL),
  ('annual-physical',       'Annual Physical Exam',            'Medical',         'eligible',    NULL,                                                                              'Pub 502 — Annual Physical',       NULL,                                                                  2025, NULL),
  ('artificial-limb',       'Artificial Limb / Prosthesis',    'Medical Equipment','eligible',   NULL,                                                                              'Pub 502 — Artificial Limb',       NULL,                                                                  2025, NULL),
  ('birth-control',         'Birth Control (Prescription)',    'Pharmacy',        'eligible',    'Prescription contraceptives; OTC contraceptives also eligible per Notice 2024-75.','Pub 502 — Birth Control Pills',  NULL,                                                                  2025, 'Updated by Notice 2024-75 (OTC eligibility).'),
  ('chiropractor',          'Chiropractor',                    'Medical',         'eligible',    NULL,                                                                              'Pub 502 — Chiropractor',          ARRAY['The Joint Chiropractic'],                                       2025, NULL),
  ('contact-lenses',        'Contact Lenses',                  'Vision',          'eligible',    'Prescription contact lenses + supplies.',                                         'Pub 502 — Contact Lenses',        NULL,                                                                  2025, NULL),
  ('crutches',              'Crutches / Mobility Aids',        'Medical Equipment','eligible',   NULL,                                                                              'Pub 502 — Crutches',              NULL,                                                                  2025, NULL),
  ('dental-treatment',      'Dental Treatment',                'Dental',          'eligible',    'Includes cleanings, fillings, extractions, X-rays. Cosmetic dentistry excluded.', 'Pub 502 — Dental Treatment',     ARRAY['Aspen Dental','dentist','orthodontist'],                        2025, 'Cosmetic dentistry (e.g. veneers for appearance) is not eligible.'),
  ('diagnostic-device',     'Diagnostic Device',               'Medical Equipment','eligible',   'Blood pressure monitors, glucose meters, pulse oximeters.',                       'Pub 502 — Diagnostic Devices',    NULL,                                                                  2025, NULL),
  ('drug-treatment',        'Drug Addiction Treatment',        'Mental Health',   'eligible',    NULL,                                                                              'Pub 502 — Drug Addiction',        NULL,                                                                  2025, NULL),
  ('eye-exam',              'Eye Examination',                 'Vision',          'eligible',    NULL,                                                                              'Pub 502 — Eye Exam',              ARRAY['LensCrafters','Pearle Vision','Optometrist'],                   2025, NULL),
  ('eyeglasses',            'Prescription Eyeglasses',         'Vision',          'eligible',    'Prescription glasses or readers. Sunglasses without prescription excluded.',     'Pub 502 — Eyeglasses',            ARRAY['Warby Parker','Eyeglass World'],                                2025, NULL),
  ('hearing-aid',           'Hearing Aid',                     'Medical Equipment','eligible',   'Includes batteries and repairs.',                                                  'Pub 502 — Hearing Aids',          NULL,                                                                  2025, NULL),
  ('hospital-services',     'Hospital Services',               'Medical',         'eligible',    'Inpatient + outpatient; emergency room visits.',                                  'Pub 502 — Hospital Services',     ARRAY['Hospital','ER','Emergency Room'],                               2025, NULL),
  ('insulin',               'Insulin',                         'Pharmacy',        'eligible',    NULL,                                                                              'Pub 502 — Insulin',               NULL,                                                                  2025, NULL),
  ('lab-fees',              'Laboratory Fees / Imaging',       'Lab / Imaging',   'eligible',    NULL,                                                                              'Pub 502 — Laboratory Fees',       ARRAY['Quest Diagnostics','LabCorp','MRI','X-ray'],                    2025, NULL),
  ('long-term-care',        'Long-Term Care',                  'Medical',         'conditional', 'Qualified long-term care services and qualified LTC insurance premiums (limits apply by age).', 'Pub 502 — Long-Term Care', NULL,                                                                  2025, NULL),
  ('mental-health',         'Mental Health Therapy',           'Mental Health',   'eligible',    'Psychiatrist, psychologist, licensed counselor.',                                 'Pub 502 — Psychiatric Care',      ARRAY['Talkspace','BetterHelp','therapist','psychiatrist'],            2025, NULL),
  ('nursing-services',      'Nursing Services',                'Medical',         'eligible',    'Wages for nursing services rendered for medical care.',                            'Pub 502 — Nursing Services',     NULL,                                                                  2025, NULL),
  ('physical-therapy',      'Physical Therapy',                'Physical Therapy','eligible',    NULL,                                                                              'Pub 502 — Physical Therapy',      ARRAY['Physical Therapy','PT'],                                        2025, NULL),
  ('physician-services',    'Physician / Doctor Services',     'Medical',         'eligible',    'Office visits, consultations, treatment.',                                        'Pub 502 — Medical Services',      ARRAY['Doctor','Family Practice','Internal Medicine','MD','DO'],       2025, NULL),
  ('podiatrist',            'Podiatrist',                      'Medical',         'eligible',    NULL,                                                                              'Pub 502 — Podiatrist',            NULL,                                                                  2025, NULL),
  ('prescription-drug',     'Prescription Drugs',              'Pharmacy',        'eligible',    'Must be prescribed by a physician (some OTC items qualify under specific notices).','Pub 502 — Medicines',            ARRAY['CVS Pharmacy','Walgreens','Rite Aid','Costco Pharmacy'],        2025, NULL),
  ('smoking-cessation',     'Smoking Cessation Program',       'Medical',         'eligible',    'Includes nicotine-replacement therapies prescribed by a doctor.',                 'Pub 502 — Stop-Smoking Programs', NULL,                                                                  2025, NULL),
  ('surgery',               'Surgery / Operations',            'Medical',         'eligible',    'Necessary medical surgery; cosmetic surgery generally excluded.',                  'Pub 502 — Operations',           NULL,                                                                  2025, NULL),
  ('telehealth',            'Telehealth Visit',                'Medical',         'eligible',    'Telehealth coverage is preventive per P.L. 119-21 — no deductible required for HDHP plans.', 'Pub 502 — Telehealth', ARRAY['Teladoc','Doctor on Demand','Amwell','MDLive'],               2025, 'Telehealth disregarded-coverage rule (Pub 969).'),
  ('vision-care',           'Vision Care (General)',           'Vision',          'eligible',    NULL,                                                                              'Pub 502 — Vision Correction',     NULL,                                                                  2025, NULL),
  ('wheelchair',            'Wheelchair',                      'Medical Equipment','eligible',   NULL,                                                                              'Pub 502 — Wheelchair',            NULL,                                                                  2025, NULL),
  -- Explicitly ineligible (seeded to discriminate against false positives)
  ('cosmetic-surgery',      'Cosmetic Surgery',                'Medical',         'ineligible',  'Surgery for purely cosmetic reasons (excludes reconstruction).',                  'Pub 502 — Cosmetic Surgery',      NULL,                                                                  2025, NULL),
  ('health-club',           'Health Club / Gym Membership',    'Medical',         'ineligible',  'Unless prescribed for a specific medical condition by a physician.',              'Pub 502 — Health Club Dues',      ARRAY['Equinox','Planet Fitness','LA Fitness'],                        2025, NULL),
  ('non-rx-supplements',    'Non-prescription Supplements',    'Pharmacy',        'ineligible',  'Vitamins and dietary supplements taken for general health are not eligible.',     'Pub 502 — Nutritional Supplements', ARRAY['GNC','Vitamin Shoppe'],                                       2025, NULL),
  ('toiletries',            'Toiletries / Personal Care',      'Other',           'ineligible',  'Toothbrushes, toothpaste, deodorant, etc. unless specifically medical.',          'Pub 502 — Toiletries',            NULL,                                                                  2025, NULL),
  ('veterinary',            'Veterinary Services',             'Medical',         'ineligible',  'Pet medical expenses do not qualify (service animals may be exceptions).',         'Pub 502 — Veterinary Fees',      ARRAY['Veterinary','Pet Hospital'],                                    2025, NULL),
  ('unclassified-other',    'Unclassified',                    'Other',           'conditional', 'Requires user-provided context to determine eligibility.',                          'Reclaim — Unclassified',         NULL,                                                                  2025, 'Reclaim catch-all. AI classifier returns this when no specific rule matches with reasonable confidence.');

-- ── 2. mcc_codes → pub_502_rules link ────────────────────────────────────
ALTER TABLE mcc_codes
  ADD COLUMN default_pub_502_rule_id TEXT REFERENCES pub_502_rules(id);

COMMENT ON COLUMN mcc_codes.default_pub_502_rule_id IS
  'Reclaim Phase 3: default Pub 502 rule that the Plaid auto-capture path stamps onto invoices when classifying by MCC alone (no AI call). The user can override during review.';

-- Map each existing medical MCC to its closest Pub 502 rule.
UPDATE mcc_codes SET default_pub_502_rule_id = CASE code
  WHEN '4119' THEN 'ambulance'
  WHEN '5912' THEN 'prescription-drug'
  WHEN '5975' THEN 'hearing-aid'
  WHEN '5976' THEN 'artificial-limb'
  WHEN '8011' THEN 'physician-services'
  WHEN '8021' THEN 'dental-treatment'
  WHEN '8031' THEN 'physician-services'
  WHEN '8041' THEN 'chiropractor'
  WHEN '8042' THEN 'eye-exam'
  WHEN '8043' THEN 'eyeglasses'
  WHEN '8049' THEN 'podiatrist'
  WHEN '8050' THEN 'long-term-care'
  WHEN '8062' THEN 'hospital-services'
  WHEN '8071' THEN 'lab-fees'
  WHEN '8099' THEN 'physician-services'
  ELSE NULL
END
WHERE is_medical = true;

-- ── 3. invoices: classification columns + audit-trail moat ───────────────
ALTER TABLE invoices
  ADD COLUMN eligibility_basis_rule_id  TEXT REFERENCES pub_502_rules(id),
  ADD COLUMN classification_confidence  NUMERIC(3,2)
    CHECK (classification_confidence IS NULL
           OR (classification_confidence >= 0 AND classification_confidence <= 1)),
  ADD COLUMN classification_reasoning   TEXT,
  ADD COLUMN classified_at              TIMESTAMPTZ,
  ADD COLUMN classification_warnings    JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN confirmed_at               TIMESTAMPTZ;

COMMENT ON COLUMN invoices.eligibility_basis_rule_id IS
  'Reclaim Phase 3: the IRS Pub 502 rule the classifier (or user) determined applies to this expense. Drives the Substantiation Record output in Phase 4.';
COMMENT ON COLUMN invoices.classification_confidence IS
  'Reclaim Phase 3: classifier confidence 0.0–1.0. >=0.8 high; 0.5–0.8 medium; <0.5 low (review queue surfaces low-confidence prominently).';
COMMENT ON COLUMN invoices.classification_reasoning IS
  'Reclaim Phase 3: human-readable explanation of why the classifier chose this rule. Surfaced verbatim in the review UI so the user can sanity-check before confirming.';
COMMENT ON COLUMN invoices.confirmed_at IS
  'Reclaim Phase 3: THE audit-trail moat. Timestamp when the user explicitly clicked Confirm Eligible or Mark Ineligible. Substantiation Records (Phase 4) cite this timestamp as the eligibility-determination event. NULL while still in PENDING_REVIEW / NEEDS_RECEIPT.';

CREATE INDEX idx_invoices_classified_at         ON invoices(classified_at)         WHERE classified_at IS NOT NULL;
CREATE INDEX idx_invoices_confirmed_at          ON invoices(confirmed_at)          WHERE confirmed_at IS NOT NULL;
CREATE INDEX idx_invoices_eligibility_basis     ON invoices(eligibility_basis_rule_id) WHERE eligibility_basis_rule_id IS NOT NULL;
