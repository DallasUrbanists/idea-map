-- Custom SQL migration file, put your code below! --
-- A separately granted inspector can check one already-known cause. This is a
-- point-in-time database observation, not proof of an independent traffic fence
-- or permission to reopen access.
CREATE FUNCTION public.inspect_independent_access_closure(closure_kind text, closure_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR
     closure_kind IS NULL OR closure_kind NOT IN ('recovery', 'operator') OR
     closure_id IS NULL OR closure_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid access closure';
  END IF;
  RETURN (SELECT is_open FROM public.public_access_gate WHERE singleton=true) IS FALSE
    AND EXISTS (SELECT 1 FROM public.public_access_closures WHERE kind=closure_kind AND cause_id=closure_id);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inspect_independent_access_closure(text, uuid) FROM PUBLIC;
