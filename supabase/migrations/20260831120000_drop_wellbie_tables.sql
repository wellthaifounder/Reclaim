-- Drop the Wellbie AI assistant's three tables.
--
-- Wellbie was the in-app chat assistant. Its UI had been hidden behind an
-- off-by-default feature flag since the soft launch, but the code, the tables
-- and -- most importantly -- the `wellbie-chat` edge function were all still
-- live. That function was reachable by any signed-in user and forwarded their
-- medical spending context to https://ai.gateway.lovable.dev, a third party
-- with no business associate agreement covering it. A feature nobody can see
-- but that can still move PHI off-platform is worse than no feature, so the
-- whole surface is being removed rather than left dormant "for re-enable".
--
-- DESTRUCTIVE. Any chat history that exists is deleted permanently, and chat
-- messages are health-related by nature. The counts are printed below before
-- anything is dropped so the deletion is on the record in the push output.
--
-- Storage note: wellbie_attachments.file_path pointed at uploaded files. This
-- migration deliberately does not touch storage objects -- an unreferenced
-- file is harmless, whereas a DELETE loop over a bucket from a migration is
-- not something to run blind. If the counts below are non-zero, the matching
-- objects are worth cleaning up by hand afterwards.

DO $$
DECLARE
  v_conversations BIGINT := 0;
  v_messages      BIGINT := 0;
  v_attachments   BIGINT := 0;
BEGIN
  IF to_regclass('public.wellbie_conversations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wellbie_conversations'
      INTO v_conversations;
  END IF;
  IF to_regclass('public.wellbie_messages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wellbie_messages' INTO v_messages;
  END IF;
  IF to_regclass('public.wellbie_attachments') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wellbie_attachments'
      INTO v_attachments;
  END IF;

  RAISE NOTICE
    'Dropping Wellbie: % conversation(s), % message(s), % attachment(s).',
    v_conversations, v_messages, v_attachments;
END
$$;

-- CASCADE takes the row-level security policies, indexes and the updated_at
-- trigger with each table; they were only ever attached to these three.
-- Order is child-first anyway, so CASCADE has nothing left to reach for.
DROP TABLE IF EXISTS public.wellbie_attachments CASCADE;
DROP TABLE IF EXISTS public.wellbie_messages CASCADE;
DROP TABLE IF EXISTS public.wellbie_conversations CASCADE;
