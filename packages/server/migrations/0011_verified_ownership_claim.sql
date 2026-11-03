-- The caller must verify the Firebase session, current account, and email on the
-- server. No client-supplied subject or email is authorized by this function.
CREATE FUNCTION public.claim_verified_idea(identity_provider text, identity_subject text, verified_email text, target_idea uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  target_owner uuid;
  target_contact uuid;
  target_email text;
  target_state public.publication_state;
  actor uuid;
  verified_identity uuid;
BEGIN
  IF identity_provider IS NULL OR identity_subject IS NULL OR verified_email IS NULL OR
     identity_provider = '' OR identity_subject = '' OR verified_email = '' OR target_idea IS NULL THEN
    RETURN false;
  END IF;
  SELECT i.owner_id, i.author_contact_id, c.normalized_email, i.publication_state
    INTO target_owner, target_contact, target_email, target_state
    FROM public.ideas i JOIN public.contacts c ON c.id = i.author_contact_id
    WHERE i.id = target_idea FOR UPDATE OF i, c;
  IF NOT FOUND OR target_owner IS NOT NULL OR target_state = 'withdrawn' OR target_email IS DISTINCT FROM verified_email THEN
    RETURN false;
  END IF;

  -- Serialize creation for the same provider subject. Existing identity rows
  -- are share-locked to prevent remapping until this transaction commits.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.jsonb_build_array(identity_provider, identity_subject)::text, 0));
  SELECT i.user_id, i.id INTO actor, verified_identity FROM public.identities i
    WHERE i.provider = identity_provider AND i.subject = identity_subject FOR SHARE OF i;
  IF NOT FOUND THEN
    INSERT INTO public.users DEFAULT VALUES RETURNING id INTO actor;
    INSERT INTO public.identities(user_id, provider, subject) VALUES (actor, identity_provider, identity_subject)
      RETURNING id INTO verified_identity;
  END IF;
  -- Ownership and trust-history writers lock the idea before the user.
  PERFORM id FROM public.users WHERE id = actor FOR UPDATE;
  INSERT INTO public.ownership_claims(idea_id, user_id, contact_id, verified_identity_id, verified_at)
    VALUES (target_idea, actor, target_contact, verified_identity, clock_timestamp());
  UPDATE public.ideas SET owner_id = actor WHERE id = target_idea;
  INSERT INTO public.audit_events(idea_id, actor_id, event_type) VALUES (target_idea, actor, 'ownership_claimed');
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_verified_idea(text, text, text, uuid) FROM PUBLIC;
