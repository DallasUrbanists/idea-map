-- Custom SQL migration file, put your code below! --
-- A pending decision is an independent reason to deny access. Close an
-- inconsistent existing gate while holding the lock used by its writers.
DO $$
BEGIN
  PERFORM 1 FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.public_access_pending_decisions) THEN
    UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_open_gate_with_closures() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.is_open AND (current_setting('transaction_isolation') <> 'read committed' OR
    EXISTS (SELECT 1 FROM public.public_access_closures) OR
    EXISTS (SELECT 1 FROM public.public_access_pending_decisions)) THEN
    RAISE EXCEPTION 'Public access unavailable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.public_access_allowed() RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE((SELECT is_open FROM public.public_access_gate WHERE singleton=true), false)
    AND NOT EXISTS (SELECT 1 FROM public.public_access_closures)
    AND NOT EXISTS (SELECT 1 FROM public.public_access_pending_decisions);
$$;
