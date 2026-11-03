-- Enable only after creating the test role and setting its password securely.
DO $test_role$
BEGIN
  IF current_database() <> 'idea_map_test_worker' THEN
    RAISE EXCEPTION 'Connect to the disposable idea_map_test_worker database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'idea_map_worker_test') THEN
    RAISE EXCEPTION 'Test worker role does not exist; apply its grants first';
  END IF;

  ALTER ROLE idea_map_worker_test LOGIN;
END
$test_role$;
