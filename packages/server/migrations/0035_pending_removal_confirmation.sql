ALTER TABLE "public_access_pending_decisions" ADD COLUMN "confirmation_record_id" uuid;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "confirmation_prepared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "applied_transaction_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "public_access_pending_confirmation_key" ON "public_access_pending_decisions" USING btree ("confirmation_record_id");--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_confirmation_fields" CHECK (("public_access_pending_decisions"."confirmation_record_id" IS NULL AND "public_access_pending_decisions"."confirmation_prepared_at" IS NULL) OR ("public_access_pending_decisions"."confirmation_record_id" IS NOT NULL AND "public_access_pending_decisions"."confirmation_record_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND "public_access_pending_decisions"."confirmation_prepared_at" IS NOT NULL AND "public_access_pending_decisions"."applied_at" IS NOT NULL AND "public_access_pending_decisions"."confirmation_prepared_at" >= "public_access_pending_decisions"."applied_at"));
--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_application_xid" CHECK ("public_access_pending_decisions"."applied_transaction_id" IS NULL OR ("public_access_pending_decisions"."applied_at" IS NOT NULL AND "public_access_pending_decisions"."applied_transaction_id" ~ '^[1-9][0-9]*$'));
--> statement-breakpoint
-- Record the top-level transaction even when the application runs in a savepoint.
-- Existing applied rows without this evidence remain blocked for manual review.
CREATE FUNCTION public.protect_pending_removal_application() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.applied_at IS NULL AND NEW.applied_at IS NOT NULL THEN
    IF NEW.applied_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
    NEW.applied_transaction_id := pg_catalog.pg_current_xact_id()::text;
  ELSIF NEW.applied_at IS DISTINCT FROM OLD.applied_at OR NEW.journal_generation IS DISTINCT FROM OLD.journal_generation OR
        NEW.applied_transaction_id IS DISTINCT FROM OLD.applied_transaction_id THEN
    RAISE EXCEPTION 'Pending removal application is immutable';
  END IF;
  IF OLD.confirmation_record_id IS NOT NULL AND (NEW.confirmation_record_id IS DISTINCT FROM OLD.confirmation_record_id OR
      NEW.confirmation_prepared_at IS DISTINCT FROM OLD.confirmation_prepared_at) THEN
    RAISE EXCEPTION 'Pending removal confirmation is immutable';
  ELSIF OLD.confirmation_record_id IS NULL AND NEW.confirmation_record_id IS NOT NULL AND
      (NEW.applied_transaction_id IS NULL OR NEW.applied_transaction_id = pg_catalog.pg_current_xact_id()::text) THEN
    RAISE EXCEPTION 'Removal application must commit before confirmation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_pending_removal_application BEFORE UPDATE ON public.public_access_pending_decisions
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_removal_application();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_pending_removal_application() FROM PUBLIC;
--> statement-breakpoint
-- The trusted coordinator and database derive the same SHA-256 UUIDv8 from
-- the operation ID. The database cannot independently verify storage.
CREATE FUNCTION public.prepare_pending_removal_confirmation(
  identity_provider text, identity_subject text, operation_id_value uuid,
  record_id_value uuid, verified_generation_value text, verified_intent_value text,
  expected_applied_at timestamptz, confirmation_record_id_value uuid
) RETURNS TABLE(confirmation_record_id uuid, confirmation_prepared_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  pending public.public_access_pending_decisions%ROWTYPE;
  gate_open boolean;
  prepared_time timestamptz;
  digest bytea;
  derived_confirmation_id uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR identity_provider IS NULL OR identity_subject IS NULL OR
     operation_id_value IS NULL OR record_id_value IS NULL OR verified_generation_value IS NULL OR verified_intent_value IS NULL OR
     octet_length(verified_intent_value) NOT BETWEEN 1 AND 16384 OR verified_generation_value !~ '^[1-9][0-9]{0,19}$' OR
     expected_applied_at IS NULL OR confirmation_record_id_value IS NULL OR
     confirmation_record_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid pending removal';
  END IF;
  digest := substring(pg_catalog.sha256(pg_catalog.decode('3fcbdfb61cb24530807a86a05f5deeb8', 'hex') ||
    pg_catalog.convert_to(operation_id_value::text, 'UTF8')) FROM 1 FOR 16);
  digest := pg_catalog.set_byte(digest, 6, (pg_catalog.get_byte(digest, 6) & 15) | 128);
  digest := pg_catalog.set_byte(digest, 8, (pg_catalog.get_byte(digest, 8) & 63) | 128);
  derived_confirmation_id := pg_catalog.encode(digest, 'hex')::uuid;
  IF confirmation_record_id_value IS DISTINCT FROM derived_confirmation_id THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR gate_open THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO pending FROM public.public_access_pending_decisions WHERE operation_id = operation_id_value FOR UPDATE;
  IF NOT FOUND OR pending.record_id IS DISTINCT FROM record_id_value OR pending.actor_id IS DISTINCT FROM actor OR
     pending.intent IS DISTINCT FROM verified_intent_value OR pending.journal_generation IS DISTINCT FROM verified_generation_value OR
     pending.applied_at IS DISTINCT FROM expected_applied_at OR pending.applied_at IS NULL THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
  IF pending.applied_transaction_id IS NULL OR pending.applied_transaction_id = pg_catalog.pg_current_xact_id()::text THEN
    RAISE EXCEPTION 'Removal application must commit before confirmation';
  END IF;
  IF pending.confirmation_record_id IS NOT NULL THEN
    IF pending.confirmation_record_id IS DISTINCT FROM confirmation_record_id_value THEN RAISE EXCEPTION 'Pending removal is ambiguous'; END IF;
    RETURN QUERY SELECT pending.confirmation_record_id, pending.confirmation_prepared_at; RETURN;
  END IF;
  prepared_time := date_trunc('milliseconds', clock_timestamp());
  IF prepared_time < pending.applied_at THEN RAISE EXCEPTION 'Pending removal clock is ambiguous'; END IF;
  UPDATE public.public_access_pending_decisions SET confirmation_record_id = confirmation_record_id_value, confirmation_prepared_at = prepared_time
    WHERE operation_id = operation_id_value;
  RETURN QUERY SELECT confirmation_record_id_value, prepared_time;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prepare_pending_removal_confirmation(text,text,uuid,uuid,text,text,timestamptz,uuid) FROM PUBLIC;
