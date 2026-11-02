-- This narrow operator primitive is not scheduled or granted to a live role.
-- It does not remove content, legal-hold records, or durable trust state.
CREATE FUNCTION public.prune_idea_decision_metadata(target_idea uuid)
RETURNS TABLE(blocked boolean, moderation_events_deleted integer, correction_events_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  cutoff timestamptz;
BEGIN
  IF NOT public.lock_idea_for_retention(target_idea) THEN
    RETURN QUERY SELECT true, 0, 0;
    RETURN;
  END IF;
  -- Use elapsed time so session time zones and DST cannot shorten retention.
  cutoff := clock_timestamp() - interval '2160 hours';
  DELETE FROM public.moderation_events AS e
    USING public.idea_revisions AS r
    WHERE e.revision_id = r.id AND r.idea_id = target_idea AND e.state IN ('approved', 'rejected') AND e.created_at < cutoff;
  GET DIAGNOSTICS moderation_events_deleted = ROW_COUNT;
  DELETE FROM public.approval_corrections AS c WHERE c.idea_id = target_idea AND c.created_at < cutoff;
  GET DIAGNOSTICS correction_events_deleted = ROW_COUNT;
  blocked := false;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_idea_decision_metadata(uuid) FROM PUBLIC;
