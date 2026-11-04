-- Run only in the disposable idea_map_test_worker database.
-- Postgres roles are branch-wide, so never change a pre-existing role.
DO $test_role$
BEGIN
  IF current_database() <> 'idea_map_test_worker' THEN
    RAISE EXCEPTION 'Connect to the disposable idea_map_test_worker database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'idea_map_worker_test') THEN
    RAISE EXCEPTION 'Test worker role already exists; inspect its ownership and grants';
  END IF;

  CREATE ROLE idea_map_worker_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  GRANT CONNECT ON DATABASE idea_map_test_worker TO idea_map_worker_test;
  GRANT USAGE ON SCHEMA public TO idea_map_worker_test;
  GRANT SELECT (id, idempotency_key, kind, revision_id, assessment_id, assessment_received_at, scheduled_at, state)
    ON public.jobs TO idea_map_worker_test;
  GRANT SELECT (id, job_id, published_at, dispatch_attempts, lease_token, lease_until, delivery_generation, created_at)
    ON public.outbox TO idea_map_worker_test;
  GRANT UPDATE (published_at, dispatch_attempts, lease_token, lease_until)
    ON public.outbox TO idea_map_worker_test;
END
$test_role$;
