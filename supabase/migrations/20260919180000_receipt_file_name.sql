-- The name the user gave the file, kept alongside the name storage gave it.
--
-- Until now the original filename was discarded at upload. The Documents page
-- generates a storage key of its own (`{user}/unattached/{type}_{uuid}.pdf`),
-- so "Averie-itemized-statement.pdf" became "invoice_a5e164c7-....pdf" and the
-- only human-readable thing left on the card was the description typed after
-- the fact. Someone looking for a bill they recognise had nothing to recognise.
--
-- This is a DISPLAY name, not the storage key. It is editable, and renaming it
-- must never move the stored object: file_path is what every signed URL, every
-- download and every claim packet resolves, and rewriting object keys to follow
-- a rename is how a packet comes to cite a file that is no longer there.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS file_name text;

COMMENT ON COLUMN public.receipts.file_name IS
  'The filename as uploaded, shown as the document title and editable by the
   owner. Display only -- file_path remains the storage key, and this column
   must never be used to locate the object.';

-- Recover the original name where the storage key still carries it.
--
-- Three of the five upload paths prefixed the name with a millisecond
-- timestamp (`{user}/{invoice}/1776045394298-IMG_7945.jpg`), so the real name
-- survives there and can be taken back. The Documents page's own uploads never
-- kept it and stay null -- the UI falls back to the description and then to the
-- document type, rather than showing a generated key it would be dishonest to
-- call a filename.
UPDATE public.receipts
   SET file_name = substring(
         regexp_replace(file_path, '^.*/', '') FROM '^[0-9]{10,}-(.+)$')
 WHERE file_name IS NULL
   AND regexp_replace(file_path, '^.*/', '') ~ '^[0-9]{10,}-.+$';
