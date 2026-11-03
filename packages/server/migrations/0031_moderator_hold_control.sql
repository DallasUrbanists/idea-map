-- The verified server supplies the provider subject. This function grants no
-- live access and exposes no direct permissions on hold or revision tables.
CREATE FUNCTION public.apply_moderator_hold(identity_provider text, identity_subject text, action text, target_revision uuid, expected_assessment text, target_hold uuid, action_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  target_idea uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR action IS NULL OR action NOT IN ('place','release') OR target_revision IS NULL OR
     (action='place' AND target_hold IS NOT NULL) OR (action='release' AND target_hold IS NULL) OR
     action_reason IS NULL OR length(trim(action_reason))=0 OR octet_length(action_reason)>1000 OR action_reason ~ '[[:cntrl:]]' OR
     (expected_assessment IS NOT NULL AND (length(expected_assessment)=0 OR octet_length(expected_assessment)>200)) THEN
    RAISE EXCEPTION 'Invalid moderator hold';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  SELECT i.id INTO target_idea FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE r.id=target_revision FOR UPDATE OF i,r;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM 1 FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE i.id=target_idea AND r.id=target_revision
      AND (action='release' OR (i.publication_state <> 'withdrawn' AND r.review_state NOT IN ('approved','rejected')))
      AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=i.id AND newer.version>r.version)
      AND (SELECT a.id FROM public.revision_assessments a WHERE a.revision_id=r.id AND a.current) IS NOT DISTINCT FROM expected_assessment;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF action='place' THEN
    INSERT INTO public.moderator_holds(revision_id,placed_by,reason,created_at)
      VALUES(target_revision,actor,trim(action_reason),clock_timestamp())
      ON CONFLICT (revision_id,kind) WHERE released_at IS NULL DO NOTHING;
    IF FOUND THEN RETURN 'placed'; ELSE RETURN 'already-held'; END IF;
  END IF;
  UPDATE public.moderator_holds SET released_by=actor,released_at=clock_timestamp(),release_reason=trim(action_reason)
    WHERE id=target_hold AND released_at IS NULL AND revision_id IN (SELECT id FROM public.idea_revisions WHERE idea_id=target_idea);
  IF FOUND THEN RETURN 'released'; ELSE RETURN 'not-held'; END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_moderator_hold(text,text,text,uuid,text,uuid,text) FROM PUBLIC;
