CREATE TABLE "moderator_change_operations" (
	"actor_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"outcome" text,
	CONSTRAINT "moderator_change_operations_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation_key"),
	CONSTRAINT "moderator_change_operations_operation_key_check" CHECK ("moderator_change_operations"."operation_key" ~ '^[A-Za-z0-9_-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "moderator_change_operations" ADD CONSTRAINT "moderator_change_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE public.moderator_change_operations FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.request_moderator_changes_once(identity_provider text, identity_subject text, target_revision uuid, expected_assessment text, action_reason text, operation_key text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  request_fingerprint text;
  receipt public.moderator_change_operations%ROWTYPE;
  result text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF operation_key IS NULL OR operation_key !~ '^[A-Za-z0-9_-]{1,128}$' OR target_revision IS NULL OR
     action_reason IS NULL OR length(trim(action_reason)) = 0 OR octet_length(action_reason) > 1000 OR action_reason ~ '[[:cntrl:]]' OR
     (expected_assessment IS NOT NULL AND (length(expected_assessment) = 0 OR octet_length(expected_assessment) > 200)) THEN
    RAISE EXCEPTION 'Invalid moderator change request';
  END IF;
  actor := public.lock_active_moderator(identity_provider, identity_subject);
  IF actor IS NULL THEN RETURN 'forbidden'; END IF;
  request_fingerprint := encode(sha256(convert_to(jsonb_build_array('request-changes', target_revision, expected_assessment, trim(action_reason))::text, 'UTF8')), 'hex');
  INSERT INTO public.moderator_change_operations(actor_id, operation_key, fingerprint)
    VALUES (actor, operation_key, request_fingerprint) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM public.moderator_change_operations o
    WHERE o.actor_id = actor AND o.operation_key = request_moderator_changes_once.operation_key FOR UPDATE;
  IF receipt.fingerprint <> request_fingerprint THEN RETURN 'idempotency-conflict'; END IF;
  IF receipt.outcome IS NOT NULL THEN RETURN receipt.outcome; END IF;
  result := public.apply_moderator_change_request(identity_provider, identity_subject, 'request', target_revision, expected_assessment, NULL, action_reason);
  UPDATE public.moderator_change_operations o SET outcome = result
    WHERE o.actor_id = actor AND o.operation_key = request_moderator_changes_once.operation_key;
  RETURN result;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_moderator_changes_once(text,text,uuid,text,text,text) FROM PUBLIC;
