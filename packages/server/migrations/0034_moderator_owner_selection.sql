-- This private selection list contains only internal IDs. It does not prove a
-- selected assignee can sign in; the action rechecks the current assignment.
CREATE FUNCTION public.list_moderator_owners(identity_provider text, identity_subject text)
RETURNS TABLE(user_id uuid, is_self boolean) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  owner_ids uuid[];
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL THEN RAISE EXCEPTION 'Invalid moderator selection'; END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moderator authorization required'; END IF;
  SELECT array_agg(selected.user_id ORDER BY selected.user_id) INTO owner_ids FROM
    (SELECT a.user_id FROM public.moderator_assignments a WHERE a.revoked_at IS NULL ORDER BY a.user_id LIMIT 101) selected;
  IF cardinality(owner_ids)>100 THEN
    RAISE EXCEPTION 'Moderator selection exceeds the supported count';
  END IF;
  RETURN QUERY SELECT selected.id, selected.id=actor FROM unnest(owner_ids) selected(id);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_moderator_owners(text,text) FROM PUBLIC;
