CREATE TABLE "public_access_closures" (
	"kind" text NOT NULL,
	"cause_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_access_closures_kind" CHECK ("public_access_closures"."kind" IN ('removal', 'recovery', 'operator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_access_closures_kind_cause_key" ON "public_access_closures" USING btree ("kind","cause_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.public_access_closures FROM PUBLIC;
--> statement-breakpoint
-- Backfill unresolved decisions while holding the same gate lock used by
-- removal preparation. A missing gate must abort the migration.
DO $$
BEGIN
  PERFORM 1 FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  INSERT INTO public.public_access_closures(kind, cause_id)
    SELECT 'removal', operation_id FROM public.public_access_pending_decisions;
  IF FOUND THEN UPDATE public.public_access_gate SET is_open=false WHERE singleton=true; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.record_pending_removal_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  INSERT INTO public.public_access_closures(kind, cause_id) VALUES ('removal', NEW.operation_id);
  UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_pending_removal_closure() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pending_removal_closure BEFORE INSERT ON public.public_access_pending_decisions
  FOR EACH ROW EXECUTE FUNCTION public.record_pending_removal_closure();
