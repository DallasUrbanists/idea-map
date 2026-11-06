-- Custom SQL migration file, put your code below! --
-- Expose only the combined access decision, not closure identities. Grant
-- execution to a reviewed reader role separately; PUBLIC receives no grant.
CREATE FUNCTION public.public_access_allowed() RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE((SELECT is_open FROM public.public_access_gate WHERE singleton=true), false)
    AND NOT EXISTS (SELECT 1 FROM public.public_access_closures);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.public_access_allowed() FROM PUBLIC;
