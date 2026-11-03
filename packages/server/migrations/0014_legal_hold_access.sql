-- These functions trust only the server to provide the verified provider and
-- subject. PUBLIC has no execute access; grants require separate review.
REVOKE ALL ON TABLE public.legal_hold_assignments, public.legal_holds FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.lock_active_legal_hold_authority(identity_provider text, identity_subject text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT a.user_id FROM public.identities i JOIN public.legal_hold_assignments a ON a.user_id = i.user_id
  WHERE i.provider = identity_provider AND i.subject = identity_subject AND a.revoked_at IS NULL
  FOR SHARE OF i, a
$$;
--> statement-breakpoint
CREATE FUNCTION public.place_legal_hold(identity_provider text, identity_subject text, target_idea uuid, case_ref text, hold_reason text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  authority_id uuid;
  actor uuid;
  hold_id uuid;
BEGIN
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_idea IS NULL OR
     case_ref IS NULL OR hold_reason IS NULL OR length(trim(case_ref)) = 0 OR
     octet_length(case_ref) > 300 OR length(trim(hold_reason)) = 0 OR octet_length(hold_reason) > 1000 OR
     case_ref ~ '[[:cntrl:]]' OR hold_reason ~ '[[:cntrl:]]' THEN RETURN NULL; END IF;
  SELECT a.id, a.user_id INTO authority_id, actor FROM public.identities i
    JOIN public.legal_hold_assignments a ON a.user_id = i.user_id
    WHERE i.provider = identity_provider AND i.subject = identity_subject AND a.revoked_at IS NULL
    FOR SHARE OF i, a;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.ideas WHERE id = target_idea FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.legal_holds(idea_id, case_reference, reason, placed_by, placement_authority_id, created_at)
    VALUES (target_idea, trim(case_ref), trim(hold_reason), actor, authority_id, clock_timestamp())
    ON CONFLICT (idea_id, case_reference) WHERE released_at IS NULL DO NOTHING RETURNING id INTO hold_id;
  RETURN hold_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.release_legal_hold(identity_provider text, identity_subject text, target_hold uuid, release_reason_text text, review_ref text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  authority_id uuid;
  actor uuid;
  target_idea uuid;
BEGIN
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_hold IS NULL OR release_reason_text IS NULL OR
     length(trim(release_reason_text)) = 0 OR octet_length(release_reason_text) > 1000 OR release_reason_text ~ '[[:cntrl:]]' OR
     (review_ref IS NOT NULL AND (length(trim(review_ref)) = 0 OR octet_length(review_ref) > 300 OR review_ref ~ '[[:cntrl:]]')) THEN RETURN false; END IF;
  SELECT a.id, a.user_id INTO authority_id, actor FROM public.identities i
    JOIN public.legal_hold_assignments a ON a.user_id = i.user_id
    WHERE i.provider = identity_provider AND i.subject = identity_subject AND a.revoked_at IS NULL
    FOR SHARE OF i, a;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT h.idea_id INTO target_idea FROM public.legal_holds h WHERE h.id = target_hold;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM id FROM public.ideas WHERE id = target_idea FOR UPDATE;
  UPDATE public.legal_holds SET released_by = actor, release_authority_id = authority_id,
    released_at = clock_timestamp(), release_reason = trim(release_reason_text), legal_review_reference = trim(review_ref)
    WHERE id = target_hold AND idea_id = target_idea AND released_at IS NULL;
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
-- The caller must keep this transaction open through its deletion or retention
-- write. A missing idea and any active hold both fail closed.
CREATE FUNCTION public.lock_idea_for_retention(target_idea uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RETURN false; END IF;
  PERFORM id FROM public.ideas WHERE id = target_idea FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.legal_holds WHERE idea_id = target_idea AND released_at IS NULL);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_active_legal_hold_authority(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.place_legal_hold(text, text, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.release_legal_hold(text, text, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_idea_for_retention(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.protect_legal_hold_assignments() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Legal-hold assignments cannot be deleted'; END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR
     (NEW.id, NEW.user_id, NEW.authority, NEW.authorization_reference, NEW.granted_by, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.authority, OLD.authorization_reference, OLD.granted_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Only revocation of an active legal-hold assignment is allowed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_hold_assignments_immutable BEFORE UPDATE OR DELETE ON public.legal_hold_assignments
FOR EACH ROW EXECUTE FUNCTION public.protect_legal_hold_assignments();
--> statement-breakpoint
CREATE FUNCTION public.check_legal_hold_delegation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.authority = 'delegate' THEN
    PERFORM id FROM public.legal_hold_assignments
      WHERE user_id = NEW.granted_by AND authority = 'executive_director' AND revoked_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'An active Executive Director must authorize a delegation'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_hold_delegation_authority BEFORE INSERT ON public.legal_hold_assignments
FOR EACH ROW EXECUTE FUNCTION public.check_legal_hold_delegation();
--> statement-breakpoint
-- Every hold insertion takes the same idea lock as the retention guard, even
-- when a future writer does not use the server's placement function.
CREATE FUNCTION public.lock_legal_hold_idea() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM id FROM public.ideas WHERE id = NEW.idea_id FOR UPDATE;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_hold_idea_lock BEFORE INSERT ON public.legal_holds
FOR EACH ROW EXECUTE FUNCTION public.lock_legal_hold_idea();
--> statement-breakpoint
CREATE FUNCTION public.protect_legal_hold_records() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Legal-hold records cannot be deleted'; END IF;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR
     (NEW.id, NEW.idea_id, NEW.case_reference, NEW.reason, NEW.placed_by, NEW.placement_authority_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.idea_id, OLD.case_reference, OLD.reason, OLD.placed_by, OLD.placement_authority_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Only release of an active legal hold is allowed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_hold_records_immutable BEFORE UPDATE OR DELETE ON public.legal_holds
FOR EACH ROW EXECUTE FUNCTION public.protect_legal_hold_records();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_legal_hold_assignments() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_legal_hold_delegation() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_legal_hold_idea() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_legal_hold_records() FROM PUBLIC;
