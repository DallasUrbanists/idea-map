-- The caller must read the exact numbered version through an independent
-- reader before invoking this function. PostgreSQL cannot verify the secret.
CREATE FUNCTION public.apply_pending_sequence_removal(
  identity_provider text, identity_subject text, operation_id_value uuid, record_id_value uuid,
  verified_version_value text, verified_intent_value text, environment_value text,
  project_number_value text, secret_id_value text, epoch_id_value uuid
) RETURNS TABLE(outcome text, applied_at timestamptz, verified_generation text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  pending public.public_access_pending_decisions%ROWTYPE;
  gate_open boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR identity_provider IS NULL OR identity_subject IS NULL OR
     operation_id_value IS NULL OR record_id_value IS NULL OR verified_intent_value IS NULL OR
     octet_length(verified_intent_value) NOT BETWEEN 1 AND 16384 OR environment_value IS NULL OR
     environment_value NOT IN ('dev', 'prod') OR verified_version_value IS NULL OR
     verified_version_value !~ '^[1-9][0-9]{0,4}$' OR verified_version_value::integer > 10000 OR
     project_number_value IS NULL OR project_number_value !~ '^[1-9][0-9]{5,19}$' OR
     secret_id_value IS NULL OR secret_id_value !~ '^[a-zA-Z0-9_-]{1,255}$' OR epoch_id_value IS NULL OR
     epoch_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid pending removal';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  -- Match the existing application's lock order, including the reader drain.
  PERFORM pg_catalog.pg_advisory_xact_lock(726421, 391);
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR gate_open THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO pending FROM public.public_access_pending_decisions WHERE operation_id = operation_id_value FOR UPDATE;
  IF NOT FOUND OR pending.actor_id IS DISTINCT FROM actor OR pending.record_id IS DISTINCT FROM record_id_value OR
     pending.intent IS DISTINCT FROM verified_intent_value OR pending.intent::jsonb->>'environment' IS DISTINCT FROM environment_value OR
     pending.journal_project_number IS DISTINCT FROM project_number_value OR pending.journal_secret_id IS DISTINCT FROM secret_id_value OR
     pending.journal_epoch_id IS DISTINCT FROM epoch_id_value OR pending.journal_target_transaction_id IS NULL OR
     pending.journal_target_transaction_id = pg_catalog.pg_current_xact_id()::text THEN
    RAISE EXCEPTION 'Pending removal is ambiguous';
  END IF;
  RETURN QUERY SELECT * FROM public.apply_pending_removal(identity_provider, identity_subject, operation_id_value,
    record_id_value, verified_version_value, verified_intent_value);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_pending_sequence_removal(text,text,uuid,uuid,text,text,text,text,text,uuid) FROM PUBLIC;
