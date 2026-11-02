-- A bounded private index of current pending revisions. It contains no content,
-- contact, ownership, assessment or reason data and creates no live grants.
CREATE FUNCTION public.list_moderator_queue(identity_provider text, identity_subject text, after_time timestamptz, after_id uuid)
RETURNS TABLE(revision_id uuid, created_at_text text, review_state text, version integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR (after_time IS NULL) <> (after_id IS NULL) OR
     (after_time IS NOT NULL AND NOT isfinite(after_time)) THEN RAISE EXCEPTION 'Invalid moderator queue cursor'; END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moderator authorization required'; END IF;
  RETURN QUERY
    SELECT r.id, to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), r.review_state::text, r.version
    FROM public.idea_revisions r JOIN public.ideas i ON i.id=r.idea_id
    WHERE i.publication_state <> 'withdrawn' AND r.review_state NOT IN ('approved','rejected')
      AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=i.id AND newer.version>r.version)
      AND (after_time IS NULL OR (r.created_at,r.id) > (after_time,after_id))
    ORDER BY r.created_at,r.id LIMIT 51;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_moderator_queue(text,text,timestamptz,uuid) FROM PUBLIC;
