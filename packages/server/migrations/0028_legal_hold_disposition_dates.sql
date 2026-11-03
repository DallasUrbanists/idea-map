CREATE TABLE "legal_hold_disposition_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hold_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"delete_by" date NOT NULL,
	"basis" text NOT NULL,
	"legal_review_reference" text,
	"actor_id" uuid NOT NULL,
	"authority_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_hold_disposition_dates_sequence" CHECK ("legal_hold_disposition_dates"."sequence" > 0),
	CONSTRAINT "legal_hold_disposition_dates_basis" CHECK (length(trim("legal_hold_disposition_dates"."basis")) > 0 AND octet_length("legal_hold_disposition_dates"."basis") <= 1000),
	CONSTRAINT "legal_hold_disposition_dates_review" CHECK ("legal_hold_disposition_dates"."legal_review_reference" IS NULL OR (length(trim("legal_hold_disposition_dates"."legal_review_reference")) > 0 AND octet_length("legal_hold_disposition_dates"."legal_review_reference") <= 300))
);
--> statement-breakpoint
ALTER TABLE "legal_hold_disposition_dates" ADD CONSTRAINT "legal_hold_disposition_dates_hold_id_legal_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."legal_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_hold_disposition_dates" ADD CONSTRAINT "legal_hold_disposition_dates_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_hold_disposition_dates" ADD CONSTRAINT "legal_hold_disposition_dates_authority_id_legal_hold_assignments_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_hold_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_hold_disposition_dates_sequence_key" ON "legal_hold_disposition_dates" USING btree ("hold_id","sequence");
--> statement-breakpoint
-- No live grants or scheduler are created. Existing released holds have no
-- deadline until an authorized person records one; there is no default.
REVOKE ALL ON TABLE public.legal_hold_disposition_dates FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.record_legal_hold_disposition(identity_provider text, identity_subject text, target_hold uuid, expected_sequence integer, delete_by_date date, date_basis text, review_ref text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  authority_id uuid;
  target_idea uuid;
  current_sequence integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Legal hold disposition requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_hold IS NULL OR expected_sequence IS NULL OR
     expected_sequence < 0 OR expected_sequence >= 2147483647 OR delete_by_date IS NULL OR NOT isfinite(delete_by_date) OR
     date_basis IS NULL OR length(trim(date_basis)) = 0 OR octet_length(date_basis) > 1000 OR date_basis ~ '[[:cntrl:]]' OR
     (review_ref IS NOT NULL AND (length(trim(review_ref)) = 0 OR octet_length(review_ref) > 300 OR review_ref ~ '[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'Invalid legal hold disposition';
  END IF;
  SELECT a.id, a.user_id INTO authority_id, actor FROM public.identities i
    JOIN public.legal_hold_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  SELECT h.idea_id INTO target_idea FROM public.legal_holds h WHERE h.id=target_hold;
  IF NOT FOUND THEN RETURN 'not-released'; END IF;
  PERFORM id FROM public.ideas WHERE id=target_idea FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not-released'; END IF;
  PERFORM id FROM public.legal_holds WHERE id=target_hold AND idea_id=target_idea AND released_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not-released'; END IF;
  SELECT COALESCE(max(sequence), 0) INTO current_sequence FROM public.legal_hold_disposition_dates WHERE hold_id=target_hold;
  IF current_sequence <> expected_sequence THEN RETURN 'stale'; END IF;
  INSERT INTO public.legal_hold_disposition_dates(hold_id,sequence,delete_by,basis,legal_review_reference,actor_id,authority_id,created_at)
    VALUES(target_hold,current_sequence+1,delete_by_date,trim(date_basis),trim(review_ref),actor,authority_id,clock_timestamp());
  RETURN 'recorded';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_legal_hold_disposition(text,text,uuid,integer,date,text,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.protect_legal_hold_disposition_date() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Legal hold disposition dates cannot be updated or deleted';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_hold_disposition_dates_immutable BEFORE UPDATE OR DELETE ON public.legal_hold_disposition_dates
FOR EACH ROW EXECUTE FUNCTION public.protect_legal_hold_disposition_date();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_legal_hold_disposition_date() FROM PUBLIC;
