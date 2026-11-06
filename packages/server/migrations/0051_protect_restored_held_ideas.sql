CREATE TABLE "restored_hold_protections" (
	"idea_id" uuid PRIMARY KEY NOT NULL,
	"recovery_closure_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restored_hold_protections" ADD CONSTRAINT "restored_hold_protections_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE public.restored_hold_protections FROM PUBLIC;
--> statement-breakpoint
-- Retain known held data before permitting normal retention on a replacement.
-- Only the independently authorized recovery coordinator can add protection.
CREATE FUNCTION public.protect_restored_held_ideas(closure_id_value uuid, target_ideas uuid[])
RETURNS TABLE(matched integer, absent integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  gate_open boolean;
  found_count integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR closure_id_value IS NULL OR target_ideas IS NULL OR
     cardinality(target_ideas) > 10000 OR (cardinality(target_ideas) > 0 AND array_ndims(target_ideas) IS DISTINCT FROM 1) OR
     array_position(target_ideas,NULL) IS NOT NULL OR
     (SELECT count(DISTINCT id) FROM unnest(target_ideas) AS input(id)) <> cardinality(target_ideas)
  THEN RAISE EXCEPTION 'Invalid recovery hold protection'; END IF;
  PERFORM pg_advisory_xact_lock(726421,391);
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton=true FOR UPDATE;
  IF NOT FOUND OR gate_open OR NOT EXISTS (
    SELECT 1 FROM public.public_access_closures WHERE kind='recovery' AND cause_id=closure_id_value
  ) THEN RAISE EXCEPTION 'Recovery closure unavailable'; END IF;
  PERFORM id FROM public.ideas WHERE id=ANY(target_ideas) ORDER BY id FOR UPDATE;
  SELECT count(*)::integer INTO found_count FROM public.ideas WHERE id=ANY(target_ideas);
  INSERT INTO public.restored_hold_protections(idea_id,recovery_closure_id)
    SELECT id,closure_id_value FROM public.ideas WHERE id=ANY(target_ideas)
    ON CONFLICT (idea_id) DO NOTHING;
  RETURN QUERY SELECT found_count,cardinality(target_ideas)-found_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_restored_held_ideas(uuid,uuid[]) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.lock_idea_for_retention(target_idea uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RETURN false; END IF;
  PERFORM id FROM public.ideas WHERE id=target_idea FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.legal_holds WHERE idea_id=target_idea AND released_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.restored_hold_protections WHERE idea_id=target_idea);
END;
$$;
