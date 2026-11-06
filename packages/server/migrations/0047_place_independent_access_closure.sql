-- Custom SQL migration file, put your code below! --
-- An explicitly granted operator capability can only add an independent
-- closure. It cannot clear causes, authorize recovery, or open the gate.
CREATE FUNCTION public.place_independent_access_closure(closure_kind text, closure_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR
     closure_kind IS NULL OR closure_kind NOT IN ('recovery', 'operator') OR
     closure_id IS NULL OR closure_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid access closure';
  END IF;
  PERFORM 1 FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  INSERT INTO public.public_access_closures(kind, cause_id) VALUES (closure_kind, closure_id)
    ON CONFLICT (kind, cause_id) DO NOTHING;
  UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.place_independent_access_closure(text, uuid) FROM PUBLIC;
