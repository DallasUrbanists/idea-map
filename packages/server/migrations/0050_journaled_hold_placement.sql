CREATE TABLE "legal_hold_journal_placements" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"hold_id" uuid NOT NULL,
	"baseline_pin" text NOT NULL,
	"intent_version" integer,
	"confirmed_at" timestamp with time zone,
	"confirmation_version" integer,
	CONSTRAINT "legal_hold_journal_placements_hold_id_unique" UNIQUE("hold_id"),
	CONSTRAINT "legal_hold_journal_baseline" CHECK ("legal_hold_journal_placements"."baseline_pin" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "legal_hold_journal_intent" CHECK (("legal_hold_journal_placements"."intent_version" IS NULL AND "legal_hold_journal_placements"."confirmed_at" IS NULL) OR ("legal_hold_journal_placements"."intent_version" IS NOT NULL AND "legal_hold_journal_placements"."intent_version" BETWEEN 2 AND 9999 AND "legal_hold_journal_placements"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "legal_hold_journal_confirmation" CHECK ("legal_hold_journal_placements"."confirmation_version" IS NULL OR ("legal_hold_journal_placements"."intent_version" IS NOT NULL AND "legal_hold_journal_placements"."confirmation_version" BETWEEN "legal_hold_journal_placements"."intent_version" + 1 AND 10000))
);
--> statement-breakpoint
ALTER TABLE "legal_hold_journal_placements" ADD CONSTRAINT "legal_hold_journal_placements_hold_id_legal_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."legal_holds"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Only the reviewed server roles may place a broad hold or attest readback.
REVOKE ALL ON TABLE public.legal_hold_journal_placements FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.prepare_journaled_hold_placement(
  identity_provider text, identity_subject text, idea_id_value uuid, request_id_value uuid,
  case_value text, reason_value text, environment_value text, project_number_value text,
  secret_id_value text, epoch_id_value uuid, checkpoint_value text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  baseline_pin_value text := public.removal_baseline_pin(environment_value, project_number_value,
    secret_id_value, epoch_id_value, checkpoint_value);
  assignment public.legal_hold_assignments%ROWTYPE;
  placement public.legal_hold_journal_placements%ROWTYPE;
  hold public.legal_holds%ROWTYPE;
  current_pin text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR idea_id_value IS NULL OR
     request_id_value IS NULL OR request_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     case_value IS NULL OR length(trim(case_value))=0 OR octet_length(case_value)>300 OR case_value ~ '[[:cntrl:]]' OR
     reason_value IS NULL OR length(trim(reason_value))=0 OR octet_length(reason_value)>1000 OR reason_value ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'Invalid hold request'; END IF;
  SELECT a.* INTO assignment FROM public.identities i JOIN public.legal_hold_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold authority unavailable'; END IF;
  SELECT removal_resume_baseline INTO current_pin FROM public.public_access_gate WHERE singleton=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal baseline unavailable'; END IF;
  -- Use the same idea lock as retention and existing hold insertions.
  PERFORM id FROM public.ideas WHERE id=idea_id_value FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO placement FROM public.legal_hold_journal_placements WHERE request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO STRICT hold FROM public.legal_holds WHERE id=placement.hold_id;
    IF hold.idea_id IS DISTINCT FROM idea_id_value OR hold.placed_by IS DISTINCT FROM assignment.user_id OR
       hold.placement_authority_id IS DISTINCT FROM assignment.id OR hold.released_at IS NOT NULL OR
       hold.case_reference IS DISTINCT FROM trim(case_value) OR hold.reason IS DISTINCT FROM trim(reason_value) OR
       placement.baseline_pin IS DISTINCT FROM baseline_pin_value OR
       (current_pin IS NOT NULL AND current_pin IS DISTINCT FROM baseline_pin_value)
    THEN RAISE EXCEPTION 'Hold request is ambiguous'; END IF;
  ELSE
    IF current_pin IS DISTINCT FROM baseline_pin_value THEN RAISE EXCEPTION 'Journal baseline unavailable'; END IF;
    INSERT INTO public.legal_holds(idea_id,case_reference,reason,placed_by,placement_authority_id,created_at)
      VALUES (idea_id_value,trim(case_value),trim(reason_value),assignment.user_id,assignment.id,clock_timestamp())
      ON CONFLICT (idea_id,case_reference) WHERE released_at IS NULL DO NOTHING RETURNING * INTO hold;
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO public.legal_hold_journal_placements(request_id,hold_id,baseline_pin)
      VALUES (request_id_value,hold.id,baseline_pin_value) RETURNING * INTO placement;
  END IF;
  RETURN jsonb_build_object(
    'holdId',hold.id, 'assignmentId',assignment.id, 'caseReference',hold.case_reference, 'reason',hold.reason,
    'authorizedAt',to_char(hold.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'placedAt',to_char(hold.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'authority',jsonb_build_object('actorId',assignment.user_id,'authority',assignment.authority,
      'grantedBy',assignment.granted_by,'grantedAt',to_char(assignment.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'authorizationReference',assignment.authorization_reference),
    'intentVersion',placement.intent_version,
    'confirmedAt',to_char(placement.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmationVersion',placement.confirmation_version);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prepare_journaled_hold_placement(text,text,uuid,uuid,text,text,text,text,text,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- The coordinator calls this only after a separately authorized exact readback.
-- Keep the first recorded position and timestamp stable across concurrent retries.
CREATE FUNCTION public.advance_journaled_hold_placement(
  identity_provider text, identity_subject text, request_id_value uuid, hold_id_value uuid,
  environment_value text, project_number_value text, secret_id_value text, epoch_id_value uuid,
  checkpoint_value text, intent_position integer, confirmation_position integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  baseline_pin_value text := public.removal_baseline_pin(environment_value, project_number_value,
    secret_id_value, epoch_id_value, checkpoint_value);
  authority_id uuid;
  idea_id_value uuid;
  current_pin text;
  placement public.legal_hold_journal_placements%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR intent_position IS NULL OR intent_position NOT BETWEEN 2 AND 9999 OR
     (confirmation_position IS NOT NULL AND confirmation_position NOT BETWEEN intent_position+1 AND 10000)
  THEN RAISE EXCEPTION 'Invalid hold journal position'; END IF;
  SELECT a.id INTO authority_id FROM public.identities i JOIN public.legal_hold_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold authority unavailable'; END IF;
  SELECT removal_resume_baseline INTO current_pin FROM public.public_access_gate WHERE singleton=true FOR SHARE;
  IF NOT FOUND OR (current_pin IS NOT NULL AND current_pin IS DISTINCT FROM baseline_pin_value)
  THEN RAISE EXCEPTION 'Journal baseline unavailable'; END IF;
  SELECT idea_id INTO idea_id_value FROM public.legal_holds WHERE id=hold_id_value;
  PERFORM id FROM public.ideas WHERE id=idea_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold unavailable'; END IF;
  SELECT p.* INTO placement FROM public.legal_hold_journal_placements p JOIN public.legal_holds h ON h.id=p.hold_id
    WHERE p.request_id=request_id_value AND p.hold_id=hold_id_value AND p.baseline_pin=baseline_pin_value
      AND h.placement_authority_id=authority_id AND h.released_at IS NULL FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold unavailable'; END IF;
  IF confirmation_position IS NULL AND placement.intent_version IS NULL THEN
    UPDATE public.legal_hold_journal_placements SET intent_version=intent_position, confirmed_at=clock_timestamp()
      WHERE request_id=request_id_value RETURNING * INTO placement;
  ELSIF confirmation_position IS NOT NULL THEN
    IF placement.intent_version IS DISTINCT FROM intent_position THEN RAISE EXCEPTION 'Hold intent unavailable'; END IF;
    IF placement.confirmation_version IS NULL THEN
      UPDATE public.legal_hold_journal_placements SET confirmation_version=confirmation_position
        WHERE request_id=request_id_value RETURNING * INTO placement;
    END IF;
  END IF;
  RETURN jsonb_build_object('intentVersion',placement.intent_version,
    'confirmedAt',to_char(placement.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmationVersion',placement.confirmation_version);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.advance_journaled_hold_placement(text,text,uuid,uuid,text,text,text,uuid,text,integer,integer) FROM PUBLIC;
