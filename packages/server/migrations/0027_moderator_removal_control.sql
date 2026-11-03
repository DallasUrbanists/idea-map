REVOKE ALL ON TABLE public.moderator_removals FROM PUBLIC;
--> statement-breakpoint
-- This records a projection intent; it does not itself invalidate a cache or
-- delete content. The server must verify the identity before calling it.
CREATE FUNCTION public.remove_published_idea(identity_provider text, identity_subject text, target_idea uuid, expected_revision uuid, removal_class text, removal_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  owner_user uuid;
  projection_job uuid;
  received_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Removal requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_idea IS NULL OR expected_revision IS NULL OR
     removal_class IS NULL OR removal_class NOT IN ('violation','other') OR removal_reason IS NULL OR
     length(trim(removal_reason)) = 0 OR octet_length(removal_reason) > 1000 OR removal_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid moderator removal';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  SELECT owner_id INTO owner_user FROM public.ideas WHERE id=target_idea FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM 1 FROM public.ideas i JOIN public.approved_revisions p ON p.idea_id=i.id
    JOIN public.idea_revisions r ON r.idea_id=i.id AND r.id=p.revision_id
    WHERE i.id=target_idea AND i.publication_state='approved' AND p.revision_id=expected_revision AND r.review_state='approved';
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF owner_user IS NOT NULL THEN PERFORM id FROM public.users WHERE id=owner_user FOR UPDATE; END IF;
  received_at := date_trunc('milliseconds', clock_timestamp());
  INSERT INTO public.jobs(kind,idempotency_key,revision_id,scheduled_at)
    VALUES ('projection', 'removal:' || target_idea::text || ':' || expected_revision::text, expected_revision, received_at)
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO projection_job;
  IF projection_job IS NULL THEN RAISE EXCEPTION 'Removal projection identity conflicts with existing intent'; END IF;
  INSERT INTO public.outbox(job_id) VALUES (projection_job);
  UPDATE public.ideas SET publication_state='withdrawn' WHERE id=target_idea;
  UPDATE public.media_previews SET published=false WHERE idea_id=target_idea AND published;
  IF removal_class='violation' THEN
    UPDATE public.approval_records SET excluded_for_violation=true, verified_for_trust=true
      WHERE idea_id=target_idea AND (NOT excluded_for_violation OR NOT verified_for_trust);
    IF FOUND THEN
      INSERT INTO public.approval_corrections(idea_id,actor_id,excluded,reason,created_at)
        VALUES (target_idea,actor,true,trim(removal_reason),received_at);
    END IF;
  END IF;
  INSERT INTO public.moderator_removals(idea_id,revision_id,actor_id,classification,reason,projection_job_id,created_at)
    VALUES (target_idea,expected_revision,actor,removal_class,trim(removal_reason),projection_job,received_at);
  RETURN 'removed';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.remove_published_idea(text,text,uuid,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.protect_moderator_removal() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Moderator removal records cannot be updated';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER moderator_removal_immutable BEFORE UPDATE ON public.moderator_removals
FOR EACH ROW EXECUTE FUNCTION public.protect_moderator_removal();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_moderator_removal() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.prune_moderator_removals(target_idea uuid)
RETURNS TABLE(blocked boolean, removals_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.lock_idea_for_retention(target_idea) THEN RETURN QUERY SELECT true, 0; RETURN; END IF;
  DELETE FROM public.moderator_removals AS r WHERE r.idea_id=target_idea AND r.created_at < clock_timestamp() - interval '2160 hours';
  GET DIAGNOSTICS removals_deleted = ROW_COUNT;
  blocked := false;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_moderator_removals(uuid) FROM PUBLIC;
