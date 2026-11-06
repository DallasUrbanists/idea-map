CREATE TABLE "legal_hold_scope_reviews" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"hold_id" uuid NOT NULL,
	"reviewer_authority_id" uuid NOT NULL,
	"selected_inventory" jsonb NOT NULL,
	"baseline_pin" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"intent_version" integer,
	"confirmed_at" timestamp with time zone,
	"confirmation_version" integer,
	CONSTRAINT "legal_hold_scope_journal_baseline" CHECK ("legal_hold_scope_reviews"."baseline_pin" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legal_hold_scope_journal_intent" CHECK (("legal_hold_scope_reviews"."intent_version" IS NULL AND "legal_hold_scope_reviews"."confirmed_at" IS NULL) OR ("legal_hold_scope_reviews"."intent_version" IS NOT NULL AND "legal_hold_scope_reviews"."intent_version" BETWEEN 2 AND 9999 AND "legal_hold_scope_reviews"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "legal_hold_scope_journal_confirmation" CHECK ("legal_hold_scope_reviews"."confirmation_version" IS NULL OR ("legal_hold_scope_reviews"."intent_version" IS NOT NULL AND "legal_hold_scope_reviews"."confirmation_version" BETWEEN "legal_hold_scope_reviews"."intent_version" + 1 AND 10000))
);
--> statement-breakpoint
ALTER TABLE "legal_hold_scope_reviews" ADD CONSTRAINT "legal_hold_scope_reviews_hold_id_legal_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."legal_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_hold_scope_reviews" ADD CONSTRAINT "legal_hold_scope_reviews_reviewer_authority_id_legal_hold_assignments_id_fk" FOREIGN KEY ("reviewer_authority_id") REFERENCES "public"."legal_hold_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_hold_scope_reviews_hold_idx" ON "legal_hold_scope_reviews" USING btree ("hold_id","reviewed_at");
--> statement-breakpoint
REVOKE ALL ON TABLE public.legal_hold_scope_reviews FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.prepare_journaled_hold_scope_review(
  identity_provider text, identity_subject text, hold_id_value uuid, operation_id_value uuid, inventory_value jsonb,
  environment_value text, project_number_value text, secret_id_value text, epoch_id_value uuid, checkpoint_value text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  baseline_pin_value text := public.removal_baseline_pin(environment_value,project_number_value,
    secret_id_value,epoch_id_value,checkpoint_value);
  assignment public.legal_hold_assignments%ROWTYPE;
  held_case public.legal_holds%ROWTYPE;
  review public.legal_hold_scope_reviews%ROWTYPE;
  current_pin text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR hold_id_value IS NULL OR
     operation_id_value IS NULL OR operation_id_value=hold_id_value OR
     operation_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     jsonb_typeof(inventory_value) IS DISTINCT FROM 'object' OR
     (inventory_value - ARRAY['artifactId','generation','size','sha256']) <> '{}'::jsonb OR
     coalesce(inventory_value->>'artifactId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     coalesce(inventory_value->>'generation','') !~ '^[1-9][0-9]{0,19}$' OR
     coalesce(inventory_value->>'size','') !~ '^[1-9][0-9]{0,7}$' OR
     coalesce(inventory_value->>'sha256','') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'Invalid hold scope review'; END IF;
  IF (inventory_value->>'size')::integer > 16777216 THEN RAISE EXCEPTION 'Invalid hold scope review'; END IF;
  SELECT a.* INTO assignment FROM public.identities i JOIN public.legal_hold_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold authority unavailable'; END IF;
  SELECT removal_resume_baseline INTO current_pin FROM public.public_access_gate WHERE singleton=true FOR SHARE;
  IF NOT FOUND OR current_pin IS DISTINCT FROM baseline_pin_value THEN RAISE EXCEPTION 'Journal baseline unavailable'; END IF;
  SELECT * INTO held_case FROM public.legal_holds h WHERE h.id=hold_id_value;
  PERFORM i.id FROM public.ideas i WHERE i.id=held_case.idea_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.legal_holds h JOIN public.legal_hold_journal_placements p ON p.hold_id=h.id
      WHERE h.id=hold_id_value AND h.released_at IS NULL AND p.baseline_pin=baseline_pin_value AND p.confirmation_version IS NOT NULL
  ) THEN RAISE EXCEPTION 'Journaled hold unavailable'; END IF;
  SELECT * INTO review FROM public.legal_hold_scope_reviews r WHERE r.operation_id=operation_id_value FOR UPDATE;
  IF FOUND THEN
    IF review.hold_id IS DISTINCT FROM hold_id_value OR review.reviewer_authority_id IS DISTINCT FROM assignment.id OR
       review.baseline_pin IS DISTINCT FROM baseline_pin_value OR review.selected_inventory IS DISTINCT FROM inventory_value
    THEN RAISE EXCEPTION 'Hold scope review is ambiguous'; END IF;
  ELSE
    INSERT INTO public.legal_hold_scope_reviews(operation_id,hold_id,reviewer_authority_id,selected_inventory,baseline_pin,reviewed_at)
      VALUES (operation_id_value,hold_id_value,assignment.id,inventory_value,baseline_pin_value,clock_timestamp()) RETURNING * INTO review;
  END IF;
  RETURN jsonb_build_object('ideaId',held_case.idea_id,'caseReference',held_case.case_reference,
    'actorId',assignment.user_id,'authorizationReference',assignment.authorization_reference,
    'authorizedAt',to_char(review.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'intentVersion',review.intent_version,'confirmationVersion',review.confirmation_version,
    'confirmedAt',to_char(review.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prepare_journaled_hold_scope_review(text,text,uuid,uuid,jsonb,text,text,text,uuid,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.advance_journaled_hold_scope_review(
  identity_provider text, identity_subject text, hold_id_value uuid, operation_id_value uuid,
  environment_value text, project_number_value text, secret_id_value text, epoch_id_value uuid, checkpoint_value text,
  intent_position integer, confirmation_position integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  baseline_pin_value text := public.removal_baseline_pin(environment_value,project_number_value,
    secret_id_value,epoch_id_value,checkpoint_value);
  authority_id uuid;
  held_idea uuid;
  review public.legal_hold_scope_reviews%ROWTYPE;
  current_pin text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR intent_position IS NULL OR intent_position NOT BETWEEN 2 AND 9999 OR
     (confirmation_position IS NOT NULL AND confirmation_position NOT BETWEEN intent_position+1 AND 10000)
  THEN RAISE EXCEPTION 'Invalid hold scope position'; END IF;
  SELECT a.id INTO authority_id FROM public.identities i JOIN public.legal_hold_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold authority unavailable'; END IF;
  SELECT removal_resume_baseline INTO current_pin FROM public.public_access_gate WHERE singleton=true FOR SHARE;
  IF NOT FOUND OR current_pin IS DISTINCT FROM baseline_pin_value THEN RAISE EXCEPTION 'Journal baseline unavailable'; END IF;
  SELECT h.idea_id INTO held_idea FROM public.legal_holds h WHERE h.id=hold_id_value;
  PERFORM i.id FROM public.ideas i WHERE i.id=held_idea FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold unavailable'; END IF;
  SELECT r.* INTO review FROM public.legal_hold_scope_reviews r JOIN public.legal_holds h ON h.id=r.hold_id
    WHERE r.operation_id=operation_id_value AND r.hold_id=hold_id_value AND r.baseline_pin=baseline_pin_value
      AND r.reviewer_authority_id=authority_id AND h.released_at IS NULL FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold scope review unavailable'; END IF;
  IF confirmation_position IS NULL AND review.intent_version IS NULL THEN
    UPDATE public.legal_hold_scope_reviews SET intent_version=intent_position,confirmed_at=clock_timestamp()
      WHERE operation_id=operation_id_value RETURNING * INTO review;
  ELSIF confirmation_position IS NOT NULL THEN
    IF review.intent_version IS DISTINCT FROM intent_position THEN RAISE EXCEPTION 'Hold scope intent unavailable'; END IF;
    IF review.confirmation_version IS NULL THEN
      UPDATE public.legal_hold_scope_reviews SET confirmation_version=confirmation_position
        WHERE operation_id=operation_id_value RETURNING * INTO review;
    END IF;
  END IF;
  RETURN jsonb_build_object('intentVersion',review.intent_version,'confirmationVersion',review.confirmation_version,
    'confirmedAt',to_char(review.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.advance_journaled_hold_scope_review(text,text,uuid,uuid,text,text,text,uuid,text,integer,integer) FROM PUBLIC;
