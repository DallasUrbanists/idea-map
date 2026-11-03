-- These primitives require a separately reviewed trusted server role. They do
-- not send mail, create a guest session, or authorize publication or ownership.
REVOKE ALL ON TABLE public.guest_email_verifications FROM PUBLIC;
--> statement-breakpoint
-- A proof for one address must never verify a replacement address.
CREATE FUNCTION public.reset_contact_verification_on_email_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.normalized_email IS DISTINCT FROM OLD.normalized_email THEN
    NEW.verified_at := NULL;
    UPDATE public.guest_email_verifications SET consumed_at=clock_timestamp() WHERE contact_id=OLD.id AND consumed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER contact_verification_email_change BEFORE UPDATE OF normalized_email ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.reset_contact_verification_on_email_change();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reset_contact_verification_on_email_change() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.lock_guest_verification_target(target_idea uuid)
RETURNS TABLE(contact_id uuid, normalized_email text) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Guest verification requires read committed isolation'; END IF;
  RETURN QUERY SELECT c.id,c.normalized_email FROM public.ideas i JOIN public.contacts c ON c.id=i.author_contact_id
    WHERE i.id=target_idea AND i.owner_id IS NULL AND i.publication_state <> 'withdrawn' FOR UPDATE OF i,c;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.create_guest_verification(target_idea uuid, target_contact uuid, token_id uuid, secret_hash text, address_mac text, ttl_seconds integer)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE created timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Guest verification requires read committed isolation'; END IF;
  IF target_idea IS NULL OR target_contact IS NULL OR token_id IS NULL OR secret_hash IS NULL OR secret_hash !~ '^[0-9a-f]{64}$' OR
     address_mac IS NULL OR address_mac !~ '^[0-9a-f]{64}$' OR ttl_seconds IS NULL OR ttl_seconds < 60 OR ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid guest verification';
  END IF;
  PERFORM 1 FROM public.ideas i JOIN public.contacts c ON c.id=i.author_contact_id
    WHERE i.id=target_idea AND c.id=target_contact AND i.owner_id IS NULL AND i.publication_state <> 'withdrawn' FOR UPDATE OF i,c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  created := date_trunc('milliseconds',clock_timestamp());
  INSERT INTO public.guest_email_verifications(id,idea_id,contact_id,secret_digest,email_mac,created_at,expires_at)
    VALUES(token_id,target_idea,target_contact,secret_hash,address_mac,created,created + ttl_seconds * interval '1 second');
  RETURN created + ttl_seconds * interval '1 second';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.lock_guest_verification(token_id uuid, secret_hash text)
RETURNS TABLE(idea_id uuid, contact_id uuid, normalized_email text, email_mac text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_idea uuid; target_contact uuid; current_email text; saved_mac text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Guest verification requires read committed isolation'; END IF;
  IF token_id IS NULL OR secret_hash IS NULL OR secret_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  SELECT v.idea_id,v.contact_id INTO target_idea,target_contact FROM public.guest_email_verifications v
    WHERE v.id=token_id AND v.secret_digest=secret_hash AND v.consumed_at IS NULL AND v.expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  SELECT c.normalized_email INTO current_email FROM public.ideas i JOIN public.contacts c ON c.id=i.author_contact_id
    WHERE i.id=target_idea AND c.id=target_contact AND i.owner_id IS NULL AND i.publication_state <> 'withdrawn' FOR UPDATE OF i,c;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT v.email_mac INTO saved_mac FROM public.guest_email_verifications v WHERE v.id=token_id AND v.idea_id=target_idea
    AND v.contact_id=target_contact AND v.secret_digest=secret_hash AND v.consumed_at IS NULL AND v.expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT target_idea,target_contact,current_email,saved_mac;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.consume_guest_verification(token_id uuid, secret_hash text, verified_mac text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_idea uuid; target_contact uuid; proof_time timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Guest verification requires read committed isolation'; END IF;
  SELECT l.idea_id,l.contact_id INTO target_idea,target_contact FROM public.lock_guest_verification(token_id,secret_hash) l
    WHERE l.email_mac=verified_mac;
  IF NOT FOUND THEN RETURN false; END IF;
  proof_time := clock_timestamp();
  UPDATE public.guest_email_verifications SET consumed_at=proof_time
    WHERE idea_id=target_idea AND contact_id=target_contact AND consumed_at IS NULL;
  UPDATE public.contacts SET verified_at=proof_time WHERE id=target_contact;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.prune_expired_guest_verifications(target_idea uuid)
RETURNS TABLE(blocked boolean, tokens_deleted integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.lock_idea_for_retention(target_idea) THEN RETURN QUERY SELECT true,0; RETURN; END IF;
  DELETE FROM public.guest_email_verifications v WHERE v.idea_id=target_idea AND v.expires_at < clock_timestamp();
  GET DIAGNOSTICS tokens_deleted = ROW_COUNT;
  blocked := false;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_guest_verification_target(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_guest_verification(uuid,uuid,uuid,text,text,integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_guest_verification(uuid,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consume_guest_verification(uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_expired_guest_verifications(uuid) FROM PUBLIC;
