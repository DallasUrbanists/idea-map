-- Run only in the disposable idea_map_test_cloudrun database.
-- The role is cluster-wide, so fail instead of changing an existing role.
DO $test_role$
BEGIN
  IF current_database() <> 'idea_map_test_cloudrun' THEN
    RAISE EXCEPTION 'Connect to the disposable idea_map_test_cloudrun database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'idea_map_cloudrun_test') THEN
    RAISE EXCEPTION 'Test runtime role already exists; inspect its ownership and grants';
  END IF;

  CREATE ROLE idea_map_cloudrun_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  GRANT CONNECT ON DATABASE idea_map_test_cloudrun TO idea_map_cloudrun_test;
  GRANT USAGE ON SCHEMA public TO idea_map_cloudrun_test;
  GRANT SELECT (id, publication_state) ON public.ideas TO idea_map_cloudrun_test;
  GRANT SELECT (idea_id, revision_id) ON public.approved_revisions TO idea_map_cloudrun_test;
  GRANT SELECT (id, idea_id, content, review_state) ON public.idea_revisions TO idea_map_cloudrun_test;
END
$test_role$;
