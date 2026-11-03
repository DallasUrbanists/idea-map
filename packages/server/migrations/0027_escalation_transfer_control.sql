REVOKE ALL ON TABLE public.moderator_escalation_transfers FROM PUBLIC;
--> statement-breakpoint
-- The server supplies the verified provider subject; owner and actor must both
-- have active moderator assignments in this transaction.
CREATE FUNCTION public.transfer_moderator_escalation(identity_provider text, identity_subject text, hold_id uuid, target_revision uuid, expected_assessment text, expected_sequence integer, new_owner uuid, transfer_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  target_idea uuid;
  initial_owner uuid;
  prior_owner uuid;
  current_sequence integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR hold_id IS NULL OR target_revision IS NULL OR new_owner IS NULL OR
     expected_sequence IS NULL OR expected_sequence < 0 OR expected_sequence >= 2147483647 OR
     transfer_reason IS NULL OR length(trim(transfer_reason)) = 0 OR octet_length(transfer_reason) > 1000 OR transfer_reason ~ '[[:cntrl:]]' OR
     (expected_assessment IS NOT NULL AND (length(expected_assessment) = 0 OR octet_length(expected_assessment) > 200)) THEN
    RAISE EXCEPTION 'Invalid escalation transfer';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  PERFORM id FROM public.moderator_assignments WHERE user_id=new_owner AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN 'owner-unavailable'; END IF;
  SELECT i.id INTO target_idea FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE r.id=target_revision FOR UPDATE OF i,r;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  PERFORM 1 FROM public.idea_revisions r WHERE r.id=target_revision AND r.idea_id=target_idea
    AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=r.idea_id AND newer.version>r.version)
    AND (SELECT a.id FROM public.revision_assessments a WHERE a.revision_id=r.id AND a.current) IS NOT DISTINCT FROM expected_assessment;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT h.owner_id INTO initial_owner FROM public.moderator_holds h JOIN public.idea_revisions r ON r.id=h.revision_id
    WHERE h.id=hold_id AND h.kind='escalation' AND h.released_at IS NULL AND r.idea_id=target_idea FOR UPDATE OF h;
  IF NOT FOUND THEN RETURN 'not-active'; END IF;
  SELECT t.owner_id, t.sequence INTO prior_owner, current_sequence FROM public.moderator_escalation_transfers t
    WHERE t.hold_id=transfer_moderator_escalation.hold_id ORDER BY t.sequence DESC LIMIT 1;
  IF NOT FOUND THEN prior_owner := initial_owner; current_sequence := 0; END IF;
  IF current_sequence <> expected_sequence THEN RETURN 'stale'; END IF;
  IF prior_owner=new_owner THEN RETURN 'unchanged'; END IF;
  INSERT INTO public.moderator_escalation_transfers(hold_id,sequence,previous_owner_id,owner_id,actor_id,revision_id,assessment_id,reason,created_at)
    VALUES (hold_id,current_sequence + 1,prior_owner,new_owner,actor,target_revision,expected_assessment,trim(transfer_reason),clock_timestamp());
  RETURN 'transferred';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transfer_moderator_escalation(text,text,uuid,uuid,text,integer,uuid,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.protect_escalation_transfer() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Escalation transfer records cannot be updated';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER escalation_transfer_immutable BEFORE UPDATE ON public.moderator_escalation_transfers
FOR EACH ROW EXECUTE FUNCTION public.protect_escalation_transfer();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_escalation_transfer() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prune_released_moderator_holds(target_idea uuid)
RETURNS TABLE(blocked boolean, holds_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE cutoff timestamptz;
BEGIN
  IF NOT public.lock_idea_for_retention(target_idea) THEN RETURN QUERY SELECT true, 0; RETURN; END IF;
  cutoff := clock_timestamp() - interval '2160 hours';
  DELETE FROM public.moderator_escalation_transfers AS t USING public.moderator_holds AS h, public.idea_revisions AS r
    WHERE t.hold_id=h.id AND h.revision_id=r.id AND r.idea_id=target_idea AND h.released_at IS NOT NULL AND h.released_at < cutoff;
  DELETE FROM public.moderator_holds AS h USING public.idea_revisions AS r
    WHERE h.revision_id=r.id AND r.idea_id=target_idea AND h.released_at IS NOT NULL AND h.released_at < cutoff;
  GET DIAGNOSTICS holds_deleted = ROW_COUNT;
  blocked := false;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_released_moderator_holds(uuid) FROM PUBLIC;
