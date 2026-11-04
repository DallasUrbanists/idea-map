ALTER TABLE "public_access_pending_decisions" ADD COLUMN "journal_project_number" text;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "journal_secret_id" text;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "journal_epoch_id" uuid;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD COLUMN "journal_target_transaction_id" text;--> statement-breakpoint
ALTER TABLE "public_access_pending_decisions" ADD CONSTRAINT "public_access_pending_journal_target" CHECK (("public_access_pending_decisions"."journal_project_number" IS NULL AND "public_access_pending_decisions"."journal_secret_id" IS NULL AND "public_access_pending_decisions"."journal_epoch_id" IS NULL AND "public_access_pending_decisions"."journal_target_transaction_id" IS NULL) OR ("public_access_pending_decisions"."journal_project_number" IS NOT NULL AND "public_access_pending_decisions"."journal_secret_id" IS NOT NULL AND "public_access_pending_decisions"."journal_epoch_id" IS NOT NULL AND "public_access_pending_decisions"."journal_target_transaction_id" IS NOT NULL AND "public_access_pending_decisions"."journal_project_number" ~ '^[1-9][0-9]{5,19}$' AND "public_access_pending_decisions"."journal_secret_id" ~ '^[a-zA-Z0-9_-]{1,255}$' AND "public_access_pending_decisions"."journal_epoch_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND "public_access_pending_decisions"."journal_target_transaction_id" ~ '^[1-9][0-9]*$'));
--> statement-breakpoint
CREATE FUNCTION public.protect_pending_sequence_target() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.journal_project_number IS NOT NULL OR NEW.journal_secret_id IS NOT NULL OR
       NEW.journal_epoch_id IS NOT NULL OR NEW.journal_target_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'Pending journal target must be pinned separately';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.journal_project_number IS NOT NULL AND
     (NEW.journal_project_number, NEW.journal_secret_id, NEW.journal_epoch_id, NEW.journal_target_transaction_id) IS DISTINCT FROM
     (OLD.journal_project_number, OLD.journal_secret_id, OLD.journal_epoch_id, OLD.journal_target_transaction_id) THEN
    RAISE EXCEPTION 'Pending journal target is immutable';
  END IF;
  IF OLD.journal_project_number IS NULL AND NEW.journal_project_number IS NOT NULL THEN
    IF OLD.applied_at IS NOT NULL OR NEW.applied_at IS NOT NULL OR NEW.journal_target_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'Applied removal requires separate reconciliation';
    END IF;
    NEW.journal_target_transaction_id := pg_catalog.pg_current_xact_id()::text;
  END IF;
  IF OLD.applied_at IS NULL AND NEW.applied_at IS NOT NULL AND OLD.journal_project_number IS NOT NULL AND
     OLD.journal_target_transaction_id = pg_catalog.pg_current_xact_id()::text THEN
    RAISE EXCEPTION 'Pending journal target must commit before application';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_pending_sequence_target BEFORE INSERT OR UPDATE ON public.public_access_pending_decisions
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_sequence_target();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_pending_sequence_target() FROM PUBLIC;
--> statement-breakpoint
-- The coordinator must pin and commit before writing a numbered sequence entry.
-- This checks the original moderator and pending bytes, but cannot verify the
-- external secret, its permissions, checkpoint, or sequence coverage.
CREATE FUNCTION public.pin_pending_removal_sequence(
  identity_provider text, identity_subject text, operation_id_value uuid, record_id_value uuid,
  intent_value text, project_number_value text, secret_id_value text, epoch_id_value uuid
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  pending public.public_access_pending_decisions%ROWTYPE;
  gate_open boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR identity_provider IS NULL OR identity_subject IS NULL OR
     operation_id_value IS NULL OR record_id_value IS NULL OR intent_value IS NULL OR octet_length(intent_value) NOT BETWEEN 1 AND 16384 OR
     project_number_value IS NULL OR project_number_value !~ '^[1-9][0-9]{5,19}$' OR
     secret_id_value IS NULL OR secret_id_value !~ '^[a-zA-Z0-9_-]{1,255}$' OR epoch_id_value IS NULL OR
     epoch_id_value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid pending journal target';
  END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending journal target is ambiguous'; END IF;
  SELECT is_open INTO gate_open FROM public.public_access_gate WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR gate_open THEN RAISE EXCEPTION 'Public access unavailable'; END IF;
  SELECT * INTO pending FROM public.public_access_pending_decisions WHERE operation_id = operation_id_value FOR UPDATE;
  IF NOT FOUND OR pending.actor_id IS DISTINCT FROM actor OR pending.record_id IS DISTINCT FROM record_id_value OR
     pending.intent IS DISTINCT FROM intent_value THEN RAISE EXCEPTION 'Pending journal target is ambiguous'; END IF;
  IF pending.journal_project_number IS NULL THEN
    IF pending.applied_at IS NOT NULL THEN RAISE EXCEPTION 'Applied removal requires separate reconciliation'; END IF;
    UPDATE public.public_access_pending_decisions SET journal_project_number=project_number_value,
      journal_secret_id=secret_id_value, journal_epoch_id=epoch_id_value WHERE operation_id=operation_id_value;
  ELSIF (pending.journal_project_number, pending.journal_secret_id, pending.journal_epoch_id) IS DISTINCT FROM
        (project_number_value, secret_id_value, epoch_id_value) THEN
    RAISE EXCEPTION 'Pending journal target is ambiguous';
  END IF;
  RETURN 'pinned';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pin_pending_removal_sequence(text,text,uuid,uuid,text,text,text,uuid) FROM PUBLIC;
