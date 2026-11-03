CREATE FUNCTION public.protect_moderator_assignments() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Moderator assignments cannot be deleted';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR
     (NEW.id, NEW.user_id, NEW.granted_by, NEW.created_at, NEW.grant_reason)
       IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.granted_by, OLD.created_at, OLD.grant_reason) THEN
    RAISE EXCEPTION 'Only revocation of an active assignment is allowed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER moderator_assignments_immutable
BEFORE UPDATE OR DELETE ON public.moderator_assignments
FOR EACH ROW EXECUTE FUNCTION public.protect_moderator_assignments();
