-- Custom SQL migration file, put your code below! --
-- A closure insertion and any attempt to open use the same gate-row lock.
-- Recording a cause only closes access; it never authorizes reopening.
CREATE FUNCTION public.close_gate_for_access_closure() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.close_gate_for_access_closure() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER close_gate_for_access_closure BEFORE INSERT ON public.public_access_closures
  FOR EACH ROW EXECUTE FUNCTION public.close_gate_for_access_closure();
--> statement-breakpoint
-- Existing closures may predate this guard. Serialize with their writers and
-- close an already-open gate before enabling the reopening check.
DO $$
BEGIN
  PERFORM 1 FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.public_access_closures) THEN
    UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
  END IF;
END;
$$;
--> statement-breakpoint
-- Read committed provides a new snapshot for the closure check after the
-- opener acquires the row lock. Other isolation levels must fail closed.
CREATE FUNCTION public.reject_open_gate_with_closures() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.is_open AND (current_setting('transaction_isolation') <> 'read committed' OR
    EXISTS (SELECT 1 FROM public.public_access_closures)) THEN
    RAISE EXCEPTION 'Public access unavailable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_open_gate_with_closures() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER reject_open_gate_with_closures BEFORE INSERT OR UPDATE OF is_open ON public.public_access_gate
  FOR EACH ROW EXECUTE FUNCTION public.reject_open_gate_with_closures();
