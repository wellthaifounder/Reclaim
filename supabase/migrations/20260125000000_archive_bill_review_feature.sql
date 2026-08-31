-- Migration: Archive Bill Review & Dispute Feature
-- Date: 2026-01-25
--
-- This migration archives the AI-powered bill review and dispute management feature
-- to reduce ongoing API costs and focus on core HSA/FSA tracking functionality.
-- The feature can be resurrected later if needed.
--
-- Tables being archived:
-- - bill_reviews (main AI analysis results)
-- - bill_errors (detected billing errors)
-- - bill_disputes (dispute case management)
-- - dispute_documents (supporting evidence)
-- - dispute_communications (communication log)
-- - cpt_code_reference (CPT code pricing data)
--
-- Related edge function: analyze-medical-bill (to be archived separately)

-- ============================================
-- 1. Drop triggers first
-- ============================================
DROP TRIGGER IF EXISTS update_bill_reviews_updated_at ON public.bill_reviews;
DROP TRIGGER IF EXISTS update_bill_disputes_updated_at ON public.bill_disputes;
DROP TRIGGER IF EXISTS update_cpt_code_reference_updated_at ON public.cpt_code_reference;

-- ============================================
-- 2. Drop tables (cascade to remove policies)
-- ============================================
-- Drop in reverse dependency order

DROP TABLE IF EXISTS public.dispute_communications CASCADE;
DROP TABLE IF EXISTS public.dispute_documents CASCADE;
DROP TABLE IF EXISTS public.bill_disputes CASCADE;
DROP TABLE IF EXISTS public.bill_errors CASCADE;
DROP TABLE IF EXISTS public.bill_reviews CASCADE;
DROP TABLE IF EXISTS public.cpt_code_reference CASCADE;

-- ============================================
-- 3. Drop enum types
-- ============================================
DROP TYPE IF EXISTS communication_direction CASCADE;
DROP TYPE IF EXISTS communication_type CASCADE;
DROP TYPE IF EXISTS document_type CASCADE;
DROP TYPE IF EXISTS dispute_status CASCADE;
DROP TYPE IF EXISTS bill_error_status CASCADE;
DROP TYPE IF EXISTS bill_error_category CASCADE;
DROP TYPE IF EXISTS bill_error_type CASCADE;
DROP TYPE IF EXISTS bill_review_status CASCADE;

-- ============================================
-- 4. Clean up profile column (optional)
-- ============================================
-- Note: Keeping has_hsa column as it may be used elsewhere
-- Uncomment if you want to remove it:
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS has_hsa;

-- ============================================
-- Migration Complete
-- ============================================
-- Manual cleanup required:
-- 1. Archive analyze-medical-bill edge function (move to _archived/ folder)
-- 2. Remove bill review UI pages:
--    - src/pages/BillReviews.tsx
--    - src/pages/BillReview.tsx
--    - src/pages/BillDispute.tsx
--    - src/pages/DisputeManagement.tsx
--    - src/pages/DisputeDetail.tsx
-- 3. Remove bill review components:
--    - src/components/bills/BillReviewCard.tsx
--    - src/components/bills/DisputeWizard.tsx
-- 4. Update App.tsx routing to remove bill review routes
-- 5. Remove LOVABLE_API_KEY from Supabase edge function secrets (if not used elsewhere)
