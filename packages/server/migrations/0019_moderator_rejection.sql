-- The caller must supply a provider subject verified by the server. The
-- function also checks and locks the current database moderator assignment.
CREATE FUNCTION public.reject_moderation_revision(identity_provider text, identity_subject text, target_revision uuid, expected_assessment text, decision_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  target_idea uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_revision IS NULL OR decision_reason IS NULL OR
     length(trim(decision_reason)) = 0 OR octet_length(decision_reason) > 1000 OR decision_reason ~ '[[:cntrl:]]' OR
     (expected_assessment IS NOT NULL AND (length(expected_assessment) = 0 OR octet_length(expected_assessment) > 200)) THEN
    RAISE EXCEPTION 'Invalid moderation decision';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  SELECT i.id INTO target_idea FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE r.id=target_revision FOR UPDATE OF i,r;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM 1 FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE i.id=target_idea AND r.id=target_revision AND i.publication_state <> 'withdrawn'
      AND r.review_state NOT IN ('approved','rejected')
      AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=i.id AND newer.version>r.version)
      AND (SELECT a.id FROM public.revision_assessments a WHERE a.revision_id=r.id AND a.current) IS NOT DISTINCT FROM expected_assessment;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  UPDATE public.idea_revisions SET review_state='rejected' WHERE id=target_revision;
  INSERT INTO public.moderation_events(revision_id,assessment_id,actor_id,state,reason,created_at)
    VALUES (target_revision,expected_assessment,actor,'rejected',trim(decision_reason),clock_timestamp());
  RETURN 'rejected';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_moderation_revision(text,text,uuid,text,text) FROM PUBLIC;
