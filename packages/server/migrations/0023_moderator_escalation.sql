-- The server supplies a currently verified provider subject; the database
-- independently checks both the acting and selected owner's active assignments.
CREATE FUNCTION public.escalate_moderation_revision(identity_provider text, identity_subject text, target_revision uuid, expected_assessment text, owner_user uuid, hold_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  target_idea uuid;
  result_id uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_revision IS NULL OR owner_user IS NULL OR hold_reason IS NULL OR
     length(trim(hold_reason)) = 0 OR octet_length(hold_reason) > 1000 OR hold_reason ~ '[[:cntrl:]]' OR
     (expected_assessment IS NOT NULL AND (length(expected_assessment) = 0 OR octet_length(expected_assessment) > 200)) THEN
    RAISE EXCEPTION 'Invalid escalation';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  PERFORM id FROM public.moderator_assignments WHERE user_id=owner_user AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN 'owner-unavailable'; END IF;
  SELECT i.id INTO target_idea FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE r.id=target_revision FOR UPDATE OF i,r;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM 1 FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE i.id=target_idea AND r.id=target_revision AND i.publication_state <> 'withdrawn'
      AND r.review_state NOT IN ('approved','rejected')
      AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=i.id AND newer.version>r.version)
      AND (SELECT a.id FROM public.revision_assessments a WHERE a.revision_id=r.id AND a.current) IS NOT DISTINCT FROM expected_assessment;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  INSERT INTO public.moderator_holds(revision_id,kind,owner_id,placed_by,created_at,reason)
    VALUES (target_revision,'escalation',owner_user,actor,clock_timestamp(),trim(hold_reason))
    ON CONFLICT (revision_id,kind) WHERE released_at IS NULL DO NOTHING RETURNING id INTO result_id;
  IF result_id IS NULL THEN RETURN 'already-escalated'; END IF;
  RETURN 'escalated';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.escalate_moderation_revision(text,text,uuid,text,uuid,text) FROM PUBLIC;
--> statement-breakpoint
-- Enforce the idea lock and preserve the originally recorded actor and owner
-- for every writer, including later code that bypasses these primitives.
CREATE FUNCTION public.lock_and_protect_moderator_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM i.id FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id WHERE r.id=NEW.revision_id FOR UPDATE OF i;
  IF TG_OP='UPDATE' AND (OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR
    (NEW.id,NEW.revision_id,NEW.kind,NEW.owner_id,NEW.placed_by,NEW.created_at,NEW.reason)
      IS DISTINCT FROM (OLD.id,OLD.revision_id,OLD.kind,OLD.owner_id,OLD.placed_by,OLD.created_at,OLD.reason)) THEN
    RAISE EXCEPTION 'Only release of an active moderator hold is allowed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER moderator_hold_idea_lock BEFORE INSERT OR UPDATE ON public.moderator_holds
FOR EACH ROW EXECUTE FUNCTION public.lock_and_protect_moderator_hold();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_and_protect_moderator_hold() FROM PUBLIC;
--> statement-breakpoint
-- Resolved hold metadata remains for at least 90 days. Active holds remain until
-- explicitly released, and a legal hold blocks the pruning transaction.
CREATE FUNCTION public.prune_released_moderator_holds(target_idea uuid)
RETURNS TABLE(blocked boolean, holds_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.lock_idea_for_retention(target_idea) THEN RETURN QUERY SELECT true, 0; RETURN; END IF;
  DELETE FROM public.moderator_holds AS h USING public.idea_revisions AS r
    WHERE h.revision_id=r.id AND r.idea_id=target_idea AND h.released_at IS NOT NULL
      AND h.released_at < clock_timestamp() - interval '2160 hours';
  GET DIAGNOSTICS holds_deleted = ROW_COUNT;
  blocked := false;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_released_moderator_holds(uuid) FROM PUBLIC;
