-- A narrowly scoped, unscheduled operator primitive. No live grants are made.
-- It preserves content, legal-hold records, accounts, backups and trust records.
CREATE FUNCTION public.prune_idea_expired_metadata(target_idea uuid)
RETURNS TABLE(blocked boolean, decisions_deleted integer, corrections_deleted integer, requests_deleted integer, holds_deleted integer, removals_deleted integer, proofs_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE decision_result record; request_result record; hold_result record; removal_result record; proof_result record;
BEGIN
  IF NOT public.lock_idea_for_retention(target_idea) THEN
    RETURN QUERY SELECT true,0,0,0,0,0,0;
    RETURN;
  END IF;
  SELECT * INTO decision_result FROM public.prune_idea_decision_metadata(target_idea);
  SELECT * INTO request_result FROM public.prune_resolved_change_requests(target_idea);
  SELECT * INTO hold_result FROM public.prune_released_moderator_holds(target_idea);
  SELECT * INTO removal_result FROM public.prune_moderator_removals(target_idea);
  SELECT * INTO proof_result FROM public.prune_expired_guest_verifications(target_idea);
  IF decision_result.blocked IS DISTINCT FROM false OR request_result.blocked IS DISTINCT FROM false OR
     hold_result.blocked IS DISTINCT FROM false OR removal_result.blocked IS DISTINCT FROM false OR proof_result.blocked IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Retention guard changed during transaction';
  END IF;
  RETURN QUERY SELECT false,decision_result.moderation_events_deleted,decision_result.correction_events_deleted,
    request_result.requests_deleted,hold_result.holds_deleted,removal_result.removals_deleted,proof_result.tokens_deleted;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_idea_expired_metadata(uuid) FROM PUBLIC;
