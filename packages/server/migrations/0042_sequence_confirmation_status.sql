ALTER TABLE "public_access_pending_decisions" ADD COLUMN "confirmation_verified_transaction_id" text;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_verification_xid" CHECK ("public_access_pending_decisions"."confirmation_verified_transaction_id" IS NULL OR ("public_access_pending_decisions"."confirmation_verified_at" IS NOT NULL AND "public_access_pending_decisions"."confirmation_verified_transaction_id" ~ '^[1-9][0-9]*$'));
--> statement-breakpoint
CREATE FUNCTION public.protect_pending_verification_transaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.confirmation_verified_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Confirmation verification is ambiguous'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.confirmation_verified_at IS NULL AND NEW.confirmation_verified_at IS NOT NULL THEN
    IF NEW.confirmation_verified_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Confirmation verification is ambiguous'; END IF;
    NEW.confirmation_verified_transaction_id := pg_catalog.pg_current_xact_id()::text;
  ELSIF NEW.confirmation_verified_transaction_id IS DISTINCT FROM OLD.confirmation_verified_transaction_id THEN
    RAISE EXCEPTION 'Confirmation verification is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_pending_verification_transaction BEFORE INSERT OR UPDATE ON public.public_access_pending_decisions
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_verification_transaction();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_pending_verification_transaction() FROM PUBLIC;
--> statement-breakpoint
-- A separately authorized reader must still compare the returned exact version.
CREATE FUNCTION public.pending_sequence_confirmation_status(
  identity_provider text, identity_subject text, operation_id_value uuid, record_id_value uuid,
  intent_value text, expected_applied_version text, expected_applied_at timestamptz,
  confirmation_record_id_value uuid, expected_prepared_at timestamptz, environment_value text,
  project_number_value text, secret_id_value text, epoch_id_value uuid
) RETURNS TABLE(outcome text, verified_at timestamptz, verified_version text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  pending public.public_access_pending_decisions%ROWTYPE;
  gate_open boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR identity_provider IS NULL OR identity_subject IS NULL OR
     operation_id_value IS NULL OR record_id_value IS NULL OR intent_value IS NULL OR octet_length(intent_value) NOT BETWEEN 1 AND 16384 OR
     expected_applied_version IS NULL OR expected_applied_version !~ '^[1-9][0-9]{0,4}$' OR expected_applied_version::integer > 10000 OR
     expected_applied_at IS NULL OR confirmation_record_id_value IS NULL OR expected_prepared_at IS NULL OR
     environment_value IS NULL OR environment_value NOT IN ('dev', 'prod') OR project_number_value IS NULL OR
     project_number_value !~ '^[1-9][0-9]{5,19}$' OR secret_id_value IS NULL OR secret_id_value !~ '^[a-zA-Z0-9_-]{1,255}$' OR
     epoch_id_value IS NULL OR epoch_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid pending removal';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR SHARE;
  IF NOT FOUND OR gate_open THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO pending FROM public.public_access_pending_decisions WHERE operation_id = operation_id_value FOR SHARE;
  IF NOT FOUND OR pending.actor_id IS DISTINCT FROM actor OR pending.record_id IS DISTINCT FROM record_id_value OR
     pending.intent IS DISTINCT FROM intent_value OR pending.intent::jsonb->>'environment' IS DISTINCT FROM environment_value OR
     pending.journal_project_number IS DISTINCT FROM project_number_value OR pending.journal_secret_id IS DISTINCT FROM secret_id_value OR
     pending.journal_epoch_id IS DISTINCT FROM epoch_id_value OR pending.journal_generation IS DISTINCT FROM expected_applied_version OR
     pending.applied_at IS DISTINCT FROM expected_applied_at OR pending.confirmation_record_id IS DISTINCT FROM confirmation_record_id_value OR
     pending.confirmation_prepared_at IS DISTINCT FROM expected_prepared_at OR pending.applied_transaction_id IS NULL OR
     pending.applied_transaction_id = pg_catalog.pg_current_xact_id()::text THEN
    RAISE EXCEPTION 'Pending removal is ambiguous';
  END IF;
  IF pending.confirmation_generation IS NULL AND pending.confirmation_verified_at IS NULL THEN
    RETURN QUERY SELECT 'unverified'::text, NULL::timestamptz, NULL::text; RETURN;
  END IF;
  IF pending.confirmation_verified_at IS NULL OR pending.confirmation_verified_transaction_id IS NULL OR
     pending.confirmation_verified_transaction_id = pg_catalog.pg_current_xact_id()::text OR
     pending.confirmation_generation IS NULL OR pending.confirmation_generation !~ '^[1-9][0-9]{0,4}$' OR
     pending.confirmation_generation::integer > 10000 OR pending.confirmation_generation::integer <= expected_applied_version::integer THEN
    RAISE EXCEPTION 'Pending removal is ambiguous';
  END IF;
  RETURN QUERY SELECT 'verified'::text, pending.confirmation_verified_at, pending.confirmation_generation;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pending_sequence_confirmation_status(text,text,uuid,uuid,text,text,timestamptz,uuid,timestamptz,text,text,text,uuid) FROM PUBLIC;
