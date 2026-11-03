-- Only the server may supply a provider subject after identity verification.
REVOKE ALL ON TABLE public.moderator_change_requests FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.apply_moderator_change_request(identity_provider text, identity_subject text, action text, target_revision uuid, expected_assessment text, request_id uuid, action_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  target_idea uuid;
  result_id uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR action IS NULL OR action NOT IN ('request','resolve') OR target_revision IS NULL OR
     action_reason IS NULL OR length(trim(action_reason)) = 0 OR octet_length(action_reason) > 1000 OR action_reason ~ '[[:cntrl:]]' OR
     (expected_assessment IS NOT NULL AND (length(expected_assessment) = 0 OR octet_length(expected_assessment) > 200)) OR
     (action = 'request' AND request_id IS NOT NULL) OR (action = 'resolve' AND request_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid moderator change request';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  SELECT i.id INTO target_idea FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE r.id=target_revision FOR UPDATE OF i,r;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM 1 FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE i.id=target_idea AND r.id=target_revision
      AND (action='resolve' OR (i.publication_state <> 'withdrawn' AND r.review_state NOT IN ('approved','rejected')))
      AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=i.id AND newer.version>r.version)
      AND (SELECT a.id FROM public.revision_assessments a WHERE a.revision_id=r.id AND a.current) IS NOT DISTINCT FROM expected_assessment;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF action='request' THEN
    INSERT INTO public.moderator_change_requests(idea_id,requested_revision_id,requested_assessment_id,requested_by,created_at,reason)
      VALUES (target_idea,target_revision,expected_assessment,actor,clock_timestamp(),trim(action_reason))
      ON CONFLICT (idea_id) WHERE resolved_at IS NULL DO NOTHING RETURNING id INTO result_id;
    IF result_id IS NULL THEN RETURN 'already-requested'; END IF;
    RETURN 'requested';
  END IF;
  UPDATE public.moderator_change_requests SET resolved_revision_id=target_revision, resolved_assessment_id=expected_assessment,
    resolved_by=actor, resolved_at=clock_timestamp(), resolution_reason=trim(action_reason)
    WHERE id=request_id AND idea_id=target_idea AND resolved_at IS NULL;
  IF FOUND THEN RETURN 'resolved'; END IF;
  RETURN 'not-requested';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_moderator_change_request(text,text,text,uuid,text,uuid,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.lock_moderator_change_idea() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM id FROM public.ideas WHERE id = NEW.idea_id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND (OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL OR
     (NEW.id,NEW.idea_id,NEW.requested_revision_id,NEW.requested_assessment_id,NEW.requested_by,NEW.created_at,NEW.reason)
       IS DISTINCT FROM (OLD.id,OLD.idea_id,OLD.requested_revision_id,OLD.requested_assessment_id,OLD.requested_by,OLD.created_at,OLD.reason)) THEN
    RAISE EXCEPTION 'Only resolution of an active change request is allowed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER moderator_change_idea_lock BEFORE INSERT OR UPDATE ON public.moderator_change_requests
FOR EACH ROW EXECUTE FUNCTION public.lock_moderator_change_idea();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_moderator_change_idea() FROM PUBLIC;
