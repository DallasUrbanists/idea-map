CREATE TABLE "public_access_pending_decisions" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"record_id" uuid NOT NULL,
	"idea_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"approved_revision_id" uuid,
	"removal_reason" text,
	"intent" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_access_pending_intent_size" CHECK (octet_length("public_access_pending_decisions"."intent") between 1 and 16384),
	CONSTRAINT "public_access_pending_removal_fields" CHECK (("public_access_pending_decisions"."approved_revision_id" IS NULL AND "public_access_pending_decisions"."removal_reason" IS NULL) OR ("public_access_pending_decisions"."approved_revision_id" IS NOT NULL AND "public_access_pending_decisions"."removal_reason" IS NOT NULL AND length(trim("public_access_pending_decisions"."removal_reason")) > 0 AND octet_length("public_access_pending_decisions"."removal_reason") <= 1000))
);
--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_decisions_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_decisions_idea_id_approved_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","approved_revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_access_pending_record_key" ON "public_access_pending_decisions" USING btree ("record_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.public_access_pending_decisions FROM PUBLIC;
--> statement-breakpoint
-- The server verifies the session before calling this function. It cannot open
-- the gate or remove content. All names are schema-qualified inside the definer.
CREATE FUNCTION public.prepare_pending_removal(
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
    IF gate_open OR previous.record_id IS DISTINCT FROM record_id_value OR previous.idea_id IS DISTINCT FROM target_idea OR
       previous.actor_id IS DISTINCT FROM actor OR previous.approved_revision_id IS DISTINCT FROM expected_revision OR
       previous.removal_reason IS DISTINCT FROM reason_value OR previous.intent::jsonb->>'environment' IS DISTINCT FROM environment_value OR
       previous.intent::jsonb->'decision'->>'classification' IS DISTINCT FROM classification_value OR
       (previous.intent::jsonb - 'authorizedAt') IS DISTINCT FROM (document - 'authorizedAt') THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
    RETURN QUERY SELECT 'pending'::text, previous.record_id, previous.intent; RETURN;
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
REVOKE ALL ON FUNCTION public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
