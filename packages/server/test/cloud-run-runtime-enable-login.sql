-- Enable the test role only after setting its separate password securely.
DO $test_role$
BEGIN
  IF current_database() <> 'idea_map_test_cloudrun' THEN
    RAISE EXCEPTION 'Connect to the disposable idea_map_test_cloudrun database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'idea_map_cloudrun_test') THEN
    RAISE EXCEPTION 'Test runtime role does not exist; apply its grants first';
  END IF;

  ALTER ROLE idea_map_cloudrun_test LOGIN;
END
$test_role$;
