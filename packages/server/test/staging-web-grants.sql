-- Run only in the disposable idea_map_test_worker database.
-- Postgres roles are branch-wide, so never change a pre-existing role.
DO $test_role$
BEGIN
  IF current_database() <> 'idea_map_test_worker' THEN
    RAISE EXCEPTION 'Connect to the disposable idea_map_test_worker database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'idea_map_staging_web_test') THEN
    RAISE EXCEPTION 'Test web role already exists; inspect its ownership and grants';
  END IF;

  CREATE ROLE idea_map_staging_web_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  GRANT CONNECT ON DATABASE idea_map_test_worker TO idea_map_staging_web_test;
  GRANT USAGE ON SCHEMA public TO idea_map_staging_web_test;
  GRANT SELECT (id, publication_state) ON public.ideas TO idea_map_staging_web_test;
  GRANT SELECT (idea_id, revision_id) ON public.approved_revisions TO idea_map_staging_web_test;
  GRANT SELECT (id, idea_id, content, review_state) ON public.idea_revisions TO idea_map_staging_web_test;
END
$test_role$;
