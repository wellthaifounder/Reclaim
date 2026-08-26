-- Create storage bucket for receipts
-- ON CONFLICT because `supabase db reset --linked` truncates the public and
-- auth schemas but NOT storage.buckets, which Supabase manages separately. A
-- bare INSERT therefore made this migration impossible to re-run against any
-- project that had ever created the bucket -- it failed on duplicate key and
-- left the rebuild stranded partway through. Found doing exactly that to
-- production on 2026-08-26.
--
-- DO NOTHING rather than DO UPDATE on purpose: `public` must stay false, and
-- silently rewriting an existing bucket's visibility from a migration is how a
-- private bucket full of receipts becomes a public one.
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for receipts
CREATE POLICY "Users can view their own receipts"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'receipts' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload their own receipts"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'receipts' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own receipts"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'receipts' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);