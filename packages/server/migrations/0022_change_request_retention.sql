-- Active requests remain until resolved. Expired resolution metadata is removed
-- only after checking all legal holds while retaining the idea lock.
CREATE FUNCTION public.prune_resolved_change_requests(target_idea uuid)
RETURNS TABLE(blocked boolean, requests_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.lock_idea_for_retention(target_idea) THEN
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;
  DELETE FROM public.moderator_change_requests AS r
    WHERE r.idea_id=target_idea AND r.resolved_at IS NOT NULL
      AND r.resolved_at < clock_timestamp() - interval '2160 hours';
  GET DIAGNOSTICS requests_deleted = ROW_COUNT;
  blocked := false;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_resolved_change_requests(uuid) FROM PUBLIC;
