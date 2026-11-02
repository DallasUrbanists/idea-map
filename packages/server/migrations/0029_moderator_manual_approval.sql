-- Server supplies the verified identity; this function also locks the current
-- moderator assignment. No public route or live grant is created.
CREATE FUNCTION public.approve_moderation_revision(identity_provider text, identity_subject text, target_revision uuid, expected_assessment text, decision_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  target_idea uuid;
  owner_user uuid;
  projection_job uuid;
  decision_at timestamptz;
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
  SELECT i.id, i.owner_id INTO target_idea, owner_user FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE r.id=target_revision FOR UPDATE OF i,r;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM 1 FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE i.id=target_idea AND r.id=target_revision AND i.publication_state <> 'withdrawn'
      AND r.review_state NOT IN ('approved','rejected')
      AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=i.id AND newer.version>r.version)
      AND (SELECT a.id FROM public.revision_assessments a WHERE a.revision_id=r.id AND a.current) IS NOT DISTINCT FROM expected_assessment;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  -- The shared idea lock serializes these checks with hold, change-request,
  -- revision, and assessment writers. A moderator must resolve each block first.
  IF EXISTS (SELECT 1 FROM public.review_gates g WHERE g.revision_id=target_revision AND g.blocked) OR
     EXISTS (SELECT 1 FROM public.moderator_holds h JOIN public.idea_revisions r ON r.id=h.revision_id WHERE r.idea_id=target_idea AND h.released_at IS NULL) OR
     EXISTS (SELECT 1 FROM public.moderator_change_requests c WHERE c.idea_id=target_idea AND c.resolved_at IS NULL) THEN
    RETURN 'blocked';
  END IF;
  IF owner_user IS NOT NULL THEN PERFORM id FROM public.users WHERE id=owner_user FOR UPDATE; END IF;
  decision_at := date_trunc('milliseconds', clock_timestamp());
  INSERT INTO public.jobs(kind,idempotency_key,revision_id,scheduled_at)
    VALUES ('projection','manual-approval:' || target_revision::text,target_revision,decision_at)
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO projection_job;
  IF projection_job IS NULL THEN RAISE EXCEPTION 'Approval projection identity conflicts with existing intent'; END IF;
  INSERT INTO public.outbox(job_id) VALUES (projection_job);
  UPDATE public.idea_revisions SET review_state='approved' WHERE id=target_revision;
  INSERT INTO public.approved_revisions(idea_id,revision_id) VALUES(target_idea,target_revision)
    ON CONFLICT (idea_id) DO UPDATE SET revision_id=EXCLUDED.revision_id;
  UPDATE public.ideas SET publication_state='approved' WHERE id=target_idea;
  INSERT INTO public.approval_records(idea_id,revision_id,verified_for_trust)
    VALUES(target_idea,target_revision,true)
    ON CONFLICT (idea_id) DO UPDATE SET revision_id=EXCLUDED.revision_id;
  INSERT INTO public.moderation_events(revision_id,assessment_id,actor_id,state,reason,created_at)
    VALUES(target_revision,expected_assessment,actor,'approved',trim(decision_reason),decision_at);
  RETURN 'approved';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.approve_moderation_revision(text,text,uuid,text,text) FROM PUBLIC;
