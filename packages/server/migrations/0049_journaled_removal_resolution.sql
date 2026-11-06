ALTER TABLE "public_access_gate" ADD COLUMN "removal_resume_baseline" text;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_access_gate" ADD CONSTRAINT "public_access_gate_removal_baseline" CHECK ("public_access_gate"."removal_resume_baseline" IS NULL OR "public_access_gate"."removal_resume_baseline" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_resolution" CHECK ("public_access_pending_decisions"."resolved_at" IS NULL OR ("public_access_pending_decisions"."confirmation_verified_at" IS NOT NULL AND "public_access_pending_decisions"."resolved_at" >= "public_access_pending_decisions"."confirmation_verified_at"));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.public_access_allowed() RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE((SELECT is_open FROM public.public_access_gate WHERE singleton=true), false)
    AND NOT EXISTS (SELECT 1 FROM public.public_access_closures)
    AND NOT EXISTS (SELECT 1 FROM public.public_access_pending_decisions WHERE resolved_at IS NULL);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_open_gate_with_closures() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.is_open AND (current_setting('transaction_isolation') <> 'read committed' OR
    EXISTS (SELECT 1 FROM public.public_access_closures) OR
    EXISTS (SELECT 1 FROM public.public_access_pending_decisions WHERE resolved_at IS NULL)) THEN
    RAISE EXCEPTION 'Public access unavailable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- The first removal of an open interval keeps the operator's authorization.
-- An independent closure revokes it, including a retry of that closure.
CREATE OR REPLACE FUNCTION public.close_gate_for_access_closure() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  gate_open boolean;
BEGIN
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  UPDATE public.public_access_gate SET is_open=false,
    removal_resume_baseline=CASE
      WHEN NEW.kind='removal' AND (gate_open OR EXISTS (SELECT 1 FROM public.public_access_closures WHERE kind='removal'))
      THEN removal_resume_baseline ELSE NULL END
    WHERE singleton=true;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.removal_baseline_pin(environment_value text, project_number_value text, secret_id_value text,
  epoch_id_value uuid, checkpoint_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF environment_value IS NULL OR environment_value NOT IN ('dev','prod') OR
     project_number_value IS NULL OR project_number_value !~ '^[1-9][0-9]{5,19}$' OR
     secret_id_value IS NULL OR secret_id_value !~ '^[a-zA-Z0-9_-]{1,255}$' OR
     epoch_id_value IS NULL OR epoch_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     checkpoint_value IS NULL OR checkpoint_value !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid removal baseline';
  END IF;
  RETURN encode(sha256(convert_to(concat_ws(':', environment_value, project_number_value, secret_id_value,
    epoch_id_value::text, checkpoint_value), 'UTF8')), 'hex');
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.removal_baseline_pin(text,text,text,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- Only an independently authorized operator can establish the baseline after
-- fencing writers and reconciling coverage outside PostgreSQL.
CREATE FUNCTION public.authorize_journaled_public_access(environment_value text, project_number_value text,
  secret_id_value text, epoch_id_value uuid, checkpoint_value text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  baseline_pin text := public.removal_baseline_pin(environment_value, project_number_value, secret_id_value,
    epoch_id_value, checkpoint_value);
  gate_open boolean;
  current_pin text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT is_open, removal_resume_baseline INTO gate_open, current_pin
    FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND OR (gate_open AND current_pin IS DISTINCT FROM baseline_pin) THEN
    RAISE EXCEPTION 'Public access unavailable';
  END IF;
  UPDATE public.public_access_gate SET is_open=true, removal_resume_baseline=baseline_pin WHERE singleton=true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.authorize_journaled_public_access(text,text,text,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- The coordinator has already read back the exact confirmation and the
-- baseline. It can resolve this removal only and cannot establish a baseline.
CREATE FUNCTION public.resolve_journaled_removal(identity_provider text, identity_subject text, operation_id_value uuid,
  record_id_value uuid, environment_value text, project_number_value text, secret_id_value text,
  epoch_id_value uuid, checkpoint_value text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  baseline_pin text := public.removal_baseline_pin(environment_value, project_number_value, secret_id_value,
    epoch_id_value, checkpoint_value);
  actor uuid;
  gate_open boolean;
  current_pin text;
  pending public.public_access_pending_decisions%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Removal resolution unavailable'; END IF;
  SELECT is_open, removal_resume_baseline INTO gate_open, current_pin
    FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO pending FROM public.public_access_pending_decisions WHERE operation_id=operation_id_value FOR UPDATE;
  IF NOT FOUND OR pending.actor_id IS DISTINCT FROM actor OR pending.record_id IS DISTINCT FROM record_id_value OR
     pending.intent::jsonb->>'environment' IS DISTINCT FROM environment_value OR
     pending.journal_project_number IS DISTINCT FROM project_number_value OR pending.journal_secret_id IS DISTINCT FROM secret_id_value OR
     pending.journal_epoch_id IS DISTINCT FROM epoch_id_value OR pending.confirmation_verified_at IS NULL OR
     pending.confirmation_verified_transaction_id IS NULL OR
     pending.confirmation_verified_transaction_id = pg_current_xact_id()::text OR
     pending.journal_generation IS NULL OR pending.journal_generation !~ '^[1-9][0-9]{0,4}$' OR
     pending.confirmation_generation IS NULL OR pending.confirmation_generation !~ '^[1-9][0-9]{0,4}$' THEN
    RAISE EXCEPTION 'Removal resolution unavailable';
  END IF;
  IF pending.journal_generation::integer >= pending.confirmation_generation::integer OR
     pending.confirmation_generation::integer > 10000 THEN RAISE EXCEPTION 'Removal resolution unavailable'; END IF;
  IF pending.resolved_at IS NOT NULL THEN RETURN public.public_access_allowed(); END IF;
  IF gate_open OR (current_pin IS NOT NULL AND current_pin <> baseline_pin) THEN
    RAISE EXCEPTION 'Removal resolution unavailable';
  END IF;
  DELETE FROM public.public_access_closures WHERE kind='removal' AND cause_id=operation_id_value;
  IF NOT FOUND THEN RAISE EXCEPTION 'Removal resolution unavailable'; END IF;
  UPDATE public.public_access_pending_decisions SET resolved_at=clock_timestamp() WHERE operation_id=operation_id_value;
  IF current_pin = baseline_pin AND NOT EXISTS (SELECT 1 FROM public.public_access_closures) AND
     NOT EXISTS (SELECT 1 FROM public.public_access_pending_decisions WHERE resolved_at IS NULL) THEN
    UPDATE public.public_access_gate SET is_open=true WHERE singleton=true;
  END IF;
  RETURN public.public_access_allowed();
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_journaled_removal(text,text,uuid,uuid,text,text,text,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- Retain the exact operation for retries after its closure is resolved.
CREATE OR REPLACE FUNCTION public.prepare_pending_removal(
  identity_provider text, identity_subject text, target_idea uuid, expected_revision uuid,
  operation_id_value uuid, record_id_value uuid, environment_value text,
  classification_value text, reason_value text, intent_value text
) RETURNS TABLE(outcome text, persisted_record_id uuid, persisted_intent text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  document jsonb;
  previous public.public_access_pending_decisions%ROWTYPE;
  gate_open boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR identity_provider IS NULL OR identity_subject IS NULL OR
     target_idea IS NULL OR expected_revision IS NULL OR operation_id_value IS NULL OR record_id_value IS NULL OR
     operation_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     record_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     environment_value IS NULL OR environment_value NOT IN ('dev', 'prod') OR classification_value IS NULL OR
     classification_value NOT IN ('violation', 'other') OR reason_value IS NULL OR length(trim(reason_value)) = 0 OR
     octet_length(reason_value) > 1000 OR reason_value ~ '[[:cntrl:]]' OR intent_value IS NULL OR
     octet_length(intent_value) NOT BETWEEN 1 AND 16384 THEN RAISE EXCEPTION 'Invalid pending removal'; END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::text; RETURN; END IF;
  IF intent_value IS NOT JSON OBJECT WITH UNIQUE KEYS THEN RAISE EXCEPTION 'Invalid pending removal'; END IF;
  BEGIN document := intent_value::jsonb; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid pending removal'; END;
  IF jsonb_typeof(document) <> 'object' OR jsonb_typeof(document->'version') IS DISTINCT FROM 'number' OR document->>'version' IS DISTINCT FROM '1' OR
     document->>'recordType' IS DISTINCT FROM 'intent' OR document->>'operationId' IS DISTINCT FROM operation_id_value::text OR
     document->>'environment' IS DISTINCT FROM environment_value OR document->>'ideaId' IS DISTINCT FROM target_idea::text OR
     document->>'actorId' IS DISTINCT FROM actor::text OR document->'decision'->>'kind' IS DISTINCT FROM 'removal' OR
     document->'decision'->>'classification' IS DISTINCT FROM classification_value OR
     document->'decision'->>'reason' IS DISTINCT FROM 'Authorized removal' OR
     jsonb_typeof(document->'authorizedAt') IS DISTINCT FROM 'string' OR
     document->>'authorizedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' OR
     (document - ARRAY['version','recordType','operationId','environment','ideaId','actorId','authorizedAt','decision']) <> '{}'::jsonb OR
     ((document->'decision') - ARRAY['kind','classification','reason']) <> '{}'::jsonb THEN RAISE EXCEPTION 'Invalid pending removal'; END IF;
  -- Commit the closed gate and pending decision before waiting for readers.
  -- A later mutation must independently take the exclusive advisory lock and
  -- drain all protected responses before applying the removal.
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO previous FROM public.public_access_pending_decisions WHERE operation_id = operation_id_value FOR UPDATE;
  IF FOUND THEN
    IF (gate_open AND previous.resolved_at IS NULL) OR previous.record_id IS DISTINCT FROM record_id_value OR previous.idea_id IS DISTINCT FROM target_idea OR
       previous.actor_id IS DISTINCT FROM actor OR previous.approved_revision_id IS DISTINCT FROM expected_revision OR
       previous.removal_reason IS DISTINCT FROM reason_value OR previous.intent::jsonb->>'environment' IS DISTINCT FROM environment_value OR
       previous.intent::jsonb->'decision'->>'classification' IS DISTINCT FROM classification_value OR
       (previous.intent::jsonb - 'authorizedAt') IS DISTINCT FROM (document - 'authorizedAt') THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
    RETURN QUERY SELECT CASE WHEN previous.resolved_at IS NULL THEN 'pending' ELSE 'resolved' END,
      previous.record_id, previous.intent; RETURN;
  END IF;
  PERFORM idea.id FROM public.ideas AS idea JOIN public.approved_revisions AS approved ON approved.idea_id=idea.id
    JOIN public.idea_revisions AS revision ON revision.id=approved.revision_id AND revision.idea_id=idea.id
    WHERE idea.id=target_idea AND idea.publication_state='approved' AND approved.revision_id=expected_revision AND revision.review_state='approved'
    FOR UPDATE OF idea;
  IF NOT FOUND THEN RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::text; RETURN; END IF;
  INSERT INTO public.public_access_pending_decisions(operation_id,record_id,idea_id,actor_id,approved_revision_id,removal_reason,intent)
    VALUES (operation_id_value,record_id_value,target_idea,actor,expected_revision,reason_value,intent_value);
  UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
  RETURN QUERY SELECT 'pending'::text, record_id_value, intent_value; RETURN;
END;
$$;
--> statement-breakpoint
-- The request path must use the same baseline that authorized normal service.
-- An independently paused service may finish an already pinned operation.
CREATE FUNCTION public.prepare_journaled_removal(
  identity_provider text, identity_subject text, target_idea uuid, expected_revision uuid,
  operation_id_value uuid, record_id_value uuid, environment_value text, classification_value text,
  reason_value text, intent_value text, project_number_value text, secret_id_value text,
  epoch_id_value uuid, checkpoint_value text
) RETURNS TABLE(outcome text, persisted_record_id uuid, persisted_intent text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  baseline_pin text := public.removal_baseline_pin(environment_value, project_number_value, secret_id_value,
    epoch_id_value, checkpoint_value);
  actor uuid;
  current_pin text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  actor := public.lock_active_moderator(identity_provider, identity_subject);
  IF actor IS NULL THEN RAISE EXCEPTION 'Removal preparation unavailable'; END IF;
  SELECT removal_resume_baseline INTO current_pin FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND OR (current_pin IS DISTINCT FROM baseline_pin AND NOT (
    current_pin IS NULL AND EXISTS (
      SELECT 1 FROM public.public_access_pending_decisions
      WHERE operation_id=operation_id_value AND actor_id=actor AND journal_project_number=project_number_value
        AND journal_secret_id=secret_id_value AND journal_epoch_id=epoch_id_value
    ))) THEN RAISE EXCEPTION 'Removal baseline is unavailable'; END IF;
  -- The request path accepts one pending removal per idea. Keep the legacy
  -- preparation function's behavior for separately reviewed existing callers.
  IF NOT EXISTS (SELECT 1 FROM public.public_access_pending_decisions WHERE operation_id=operation_id_value)
    AND EXISTS (SELECT 1 FROM public.public_access_pending_decisions WHERE idea_id=target_idea AND resolved_at IS NULL)
  THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::text; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.prepare_pending_removal(identity_provider, identity_subject,
    target_idea, expected_revision, operation_id_value, record_id_value, environment_value,
    classification_value, reason_value, intent_value);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prepare_journaled_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,text) FROM PUBLIC;
