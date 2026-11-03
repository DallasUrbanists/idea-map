-- Preserve the original SQL API while reporting missing targets and retries.
-- New entry points require separately reviewed grants; no table access is added.
CREATE FUNCTION public.place_legal_hold_outcome(identity_provider text, identity_subject text, target_idea uuid, case_ref text, hold_reason text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  authority_id uuid;
  actor uuid;
  hold_id uuid;
BEGIN
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_idea IS NULL OR
     case_ref IS NULL OR hold_reason IS NULL OR length(trim(case_ref)) = 0 OR
     octet_length(case_ref) > 300 OR length(trim(hold_reason)) = 0 OR octet_length(hold_reason) > 1000 OR
     case_ref ~ '[[:cntrl:]]' OR hold_reason ~ '[[:cntrl:]]' THEN RETURN 'forbidden'; END IF;
  SELECT a.id, a.user_id INTO authority_id, actor FROM public.identities i
    JOIN public.legal_hold_assignments a ON a.user_id = i.user_id
    WHERE i.provider = identity_provider AND i.subject = identity_subject AND a.revoked_at IS NULL
    FOR SHARE OF i, a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  PERFORM id FROM public.ideas WHERE id = target_idea FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  INSERT INTO public.legal_holds(idea_id, case_reference, reason, placed_by, placement_authority_id, created_at)
    VALUES (target_idea, trim(case_ref), trim(hold_reason), actor, authority_id, clock_timestamp())
    ON CONFLICT (idea_id, case_reference) WHERE released_at IS NULL DO NOTHING RETURNING id INTO hold_id;
  IF hold_id IS NULL THEN RETURN 'already_held'; END IF;
  RETURN 'processed';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.release_legal_hold_outcome(identity_provider text, identity_subject text, target_hold uuid, release_reason_text text, review_ref text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  authority_id uuid;
  actor uuid;
  target_idea uuid;
BEGIN
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_hold IS NULL OR release_reason_text IS NULL OR
     length(trim(release_reason_text)) = 0 OR octet_length(release_reason_text) > 1000 OR release_reason_text ~ '[[:cntrl:]]' OR
     (review_ref IS NOT NULL AND (length(trim(review_ref)) = 0 OR octet_length(review_ref) > 300 OR review_ref ~ '[[:cntrl:]]')) THEN RETURN 'forbidden'; END IF;
  SELECT a.id, a.user_id INTO authority_id, actor FROM public.identities i
    JOIN public.legal_hold_assignments a ON a.user_id = i.user_id
    WHERE i.provider = identity_provider AND i.subject = identity_subject AND a.revoked_at IS NULL
    FOR SHARE OF i, a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  SELECT h.idea_id INTO target_idea FROM public.legal_holds h WHERE h.id = target_hold;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  PERFORM id FROM public.ideas WHERE id = target_idea FOR UPDATE;
  UPDATE public.legal_holds SET released_by = actor, release_authority_id = authority_id,
    released_at = clock_timestamp(), release_reason = trim(release_reason_text), legal_review_reference = trim(review_ref)
    WHERE id = target_hold AND idea_id = target_idea AND released_at IS NULL;
  IF FOUND THEN RETURN 'processed'; END IF;
  RETURN 'already_released';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.place_legal_hold_outcome(text,text,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.release_legal_hold_outcome(text,text,uuid,text,text) FROM PUBLIC;
