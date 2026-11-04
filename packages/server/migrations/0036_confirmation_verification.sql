ALTER TABLE "public_access_pending_decisions" ADD COLUMN "confirmation_generation" text;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "confirmation_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_verified_confirmation" CHECK (("public_access_pending_decisions"."confirmation_generation" IS NULL AND "public_access_pending_decisions"."confirmation_verified_at" IS NULL) OR ("public_access_pending_decisions"."confirmation_generation" IS NOT NULL AND "public_access_pending_decisions"."confirmation_generation" ~ '^[1-9][0-9]{0,19}$' AND "public_access_pending_decisions"."confirmation_verified_at" IS NOT NULL AND "public_access_pending_decisions"."confirmation_prepared_at" IS NOT NULL AND "public_access_pending_decisions"."confirmation_verified_at" >= "public_access_pending_decisions"."confirmation_prepared_at"));
--> statement-breakpoint
CREATE FUNCTION public.protect_pending_confirmation_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.confirmation_generation IS NOT NULL AND
     (NEW.confirmation_generation IS DISTINCT FROM OLD.confirmation_generation OR
      NEW.confirmation_verified_at IS DISTINCT FROM OLD.confirmation_verified_at) THEN
    RAISE EXCEPTION 'Confirmation verification is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_pending_confirmation_verification BEFORE UPDATE ON public.public_access_pending_decisions
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_confirmation_verification();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_pending_confirmation_verification() FROM PUBLIC;
--> statement-breakpoint
-- The separately trusted coordinator must compare the current journal generation
-- and exact canonical confirmation before invoking this function. The database
-- cannot verify the storage object. Verification never opens the public gate.
CREATE FUNCTION public.verify_pending_removal_confirmation(
  identity_provider text, identity_subject text, operation_id_value uuid,
  confirmation_record_id_value uuid, expected_prepared_at timestamptz, verified_generation_value text
) RETURNS TABLE(confirmation_verified_at timestamptz, confirmation_generation text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  pending public.public_access_pending_decisions%ROWTYPE;
  gate_open boolean;
  verified_time timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR identity_provider IS NULL OR identity_subject IS NULL OR
     operation_id_value IS NULL OR confirmation_record_id_value IS NULL OR expected_prepared_at IS NULL OR
     verified_generation_value IS NULL OR verified_generation_value !~ '^[1-9][0-9]{0,19}$' THEN
    RAISE EXCEPTION 'Invalid pending removal';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR gate_open THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO pending FROM public.public_access_pending_decisions WHERE operation_id = operation_id_value FOR UPDATE;
  IF NOT FOUND OR pending.actor_id IS DISTINCT FROM actor OR pending.applied_at IS NULL OR
     pending.confirmation_record_id IS DISTINCT FROM confirmation_record_id_value OR
     pending.confirmation_prepared_at IS DISTINCT FROM expected_prepared_at THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  IF pending.confirmation_generation IS NOT NULL THEN
    IF pending.confirmation_generation IS DISTINCT FROM verified_generation_value THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
    RETURN QUERY SELECT pending.confirmation_verified_at, pending.confirmation_generation; RETURN;
  END IF;
  verified_time := date_trunc('milliseconds', clock_timestamp());
  IF verified_time < pending.confirmation_prepared_at THEN RAISE EXCEPTION 'Pending removal clock is ambiguous'; END IF;
  UPDATE public.public_access_pending_decisions SET confirmation_generation = verified_generation_value, confirmation_verified_at = verified_time
    WHERE operation_id = operation_id_value;
  RETURN QUERY SELECT verified_time, verified_generation_value;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.verify_pending_removal_confirmation(text,text,uuid,uuid,timestamptz,text) FROM PUBLIC;
