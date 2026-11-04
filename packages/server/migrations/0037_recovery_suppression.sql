-- Custom SQL migration file, put your code below! --
-- This is a suppression-only recovery primitive. It must be granted only to
-- an independently authorized recovery coordinator after the replacement and
-- all writers are fenced. It neither proves journal coverage nor opens access.
CREATE FUNCTION public.suppress_restored_removals(target_ideas uuid[])
RETURNS TABLE(matched integer, absent integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  gate_open boolean;
  found_count integer;
  distinct_count integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR target_ideas IS NULL OR
     cardinality(target_ideas) > 10000 OR (cardinality(target_ideas) > 0 AND array_ndims(target_ideas) IS DISTINCT FROM 1) OR
     array_position(target_ideas, NULL) IS NOT NULL THEN RAISE EXCEPTION 'Invalid recovery suppression'; END IF;
  SELECT count(DISTINCT id)::integer INTO distinct_count FROM unnest(target_ideas) AS input(id);
  IF distinct_count <> cardinality(target_ideas) THEN RAISE EXCEPTION 'Invalid recovery suppression'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(726421, 391);
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR gate_open THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  PERFORM id FROM public.ideas WHERE id = ANY(target_ideas) ORDER BY id FOR UPDATE;
  SELECT count(*)::integer INTO found_count FROM public.ideas WHERE id = ANY(target_ideas);
  UPDATE public.ideas SET publication_state = 'withdrawn'
    WHERE id = ANY(target_ideas) AND publication_state <> 'withdrawn';
  UPDATE public.media_previews SET published = false WHERE idea_id = ANY(target_ideas) AND published;
  RETURN QUERY SELECT found_count, cardinality(target_ideas) - found_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.suppress_restored_removals(uuid[]) FROM PUBLIC;
