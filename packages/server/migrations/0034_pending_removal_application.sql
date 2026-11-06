ALTER TABLE "public_access_pending_decisions" ADD COLUMN "journal_generation" text;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_applied_fields" CHECK (("public_access_pending_decisions"."journal_generation" IS NULL AND "public_access_pending_decisions"."applied_at" IS NULL) OR ("public_access_pending_decisions"."journal_generation" IS NOT NULL AND "public_access_pending_decisions"."journal_generation" ~ '^[1-9][0-9]*$' AND "public_access_pending_decisions"."applied_at" IS NOT NULL));
--> statement-breakpoint
-- Only a separately trusted coordinator may call this function after verifying
-- the saved intent against the named live journal generation. PostgreSQL cannot
-- independently verify Cloud Storage. The server must also verify the session.
CREATE FUNCTION public.apply_pending_removal(
  identity_provider text, identity_subject text, operation_id_value uuid,
  record_id_value uuid, verified_generation_value text, verified_intent_value text
) RETURNS TABLE(outcome text, applied_at timestamptz, verified_generation text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  pending public.public_access_pending_decisions%ROWTYPE;
  gate_open boolean;
  decision text;
  applied_time timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR identity_provider IS NULL OR identity_subject IS NULL OR
     operation_id_value IS NULL OR record_id_value IS NULL OR verified_generation_value IS NULL OR verified_intent_value IS NULL OR
     octet_length(verified_intent_value) NOT BETWEEN 1 AND 16384 OR
     verified_generation_value !~ '^[1-9][0-9]{0,19}$' THEN RAISE EXCEPTION 'Invalid pending removal'; END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN QUERY SELECT 'forbidden'::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  -- The closed gate is committed before this lock is requested. Waiting for
  -- readers or a timeout must never reopen the gate or discard the decision.
  PERFORM pg_catalog.pg_advisory_xact_lock(726421, 391);
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR gate_open THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO pending FROM public.public_access_pending_decisions WHERE operation_id = operation_id_value FOR UPDATE;
  IF NOT FOUND OR pending.record_id IS DISTINCT FROM record_id_value OR pending.actor_id IS DISTINCT FROM actor OR
     pending.intent IS DISTINCT FROM verified_intent_value OR
     pending.approved_revision_id IS NULL OR pending.removal_reason IS NULL THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  IF pending.applied_at IS NOT NULL THEN
    IF pending.journal_generation IS DISTINCT FROM verified_generation_value THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
    RETURN QUERY SELECT 'applied'::text, pending.applied_at, pending.journal_generation; RETURN;
  END IF;
  decision := public.remove_published_idea(identity_provider, identity_subject, pending.idea_id, pending.approved_revision_id,
    pending.intent::jsonb->'decision'->>'classification', pending.removal_reason);
  IF decision = 'stale' THEN RETURN QUERY SELECT 'stale'::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  IF decision IS DISTINCT FROM 'removed' THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  applied_time := date_trunc('milliseconds', clock_timestamp());
  IF applied_time < (pending.intent::jsonb->>'authorizedAt')::timestamptz THEN RAISE EXCEPTION 'Pending removal clock is ambiguous'; END IF;
  UPDATE public.public_access_pending_decisions SET journal_generation = verified_generation_value, applied_at = applied_time
    WHERE operation_id = operation_id_value;
  RETURN QUERY SELECT 'applied'::text, applied_time, verified_generation_value;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_pending_removal(text,text,uuid,uuid,text,text) FROM PUBLIC;
