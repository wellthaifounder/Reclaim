-- Migration: Add Wellbie attachments table for conversational bill upload
-- Purpose: Store file attachments within Wellbie chat conversations
-- Date: 2026-01-09

-- Create wellbie_attachments table
CREATE TABLE IF NOT EXISTS wellbie_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES wellbie_messages(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES wellbie_conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  analysis_status TEXT DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'analyzing', 'completed', 'failed')),
  analysis_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments
COMMENT ON TABLE wellbie_attachments IS 'Stores file attachments uploaded through Wellbie chat for bill analysis';
COMMENT ON COLUMN wellbie_attachments.message_id IS 'Reference to the message this attachment belongs to (nullable for pre-analysis uploads)';
COMMENT ON COLUMN wellbie_attachments.analysis_status IS 'Status of AI bill analysis: pending, analyzing, completed, failed';
COMMENT ON COLUMN wellbie_attachments.analysis_result IS 'Full AI analysis result including metadata and errors';

-- Enable RLS
ALTER TABLE wellbie_attachments ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own attachments"
  ON wellbie_attachments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own attachments"
  ON wellbie_attachments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own attachments"
  ON wellbie_attachments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own attachments"
  ON wellbie_attachments FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX idx_wellbie_attachments_conversation
  ON wellbie_attachments(conversation_id);

CREATE INDEX idx_wellbie_attachments_user
  ON wellbie_attachments(user_id);

CREATE INDEX idx_wellbie_attachments_status
  ON wellbie_attachments(analysis_status)
  WHERE analysis_status != 'completed';
