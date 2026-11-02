CREATE TABLE "moderator_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grant_reason" text NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "moderator_assignments_grant_reason" CHECK (length(trim("moderator_assignments"."grant_reason")) > 0 AND octet_length("moderator_assignments"."grant_reason") <= 1000),
	CONSTRAINT "moderator_assignments_revoke_fields" CHECK (("moderator_assignments"."revoked_at" IS NULL AND "moderator_assignments"."revoked_by" IS NULL AND "moderator_assignments"."revoke_reason" IS NULL) OR ("moderator_assignments"."revoked_at" IS NOT NULL AND "moderator_assignments"."revoked_by" IS NOT NULL AND "moderator_assignments"."revoke_reason" IS NOT NULL AND length(trim("moderator_assignments"."revoke_reason")) > 0 AND octet_length("moderator_assignments"."revoke_reason") <= 1000))
);
--> statement-breakpoint
ALTER TABLE "moderator_assignments" ADD CONSTRAINT "moderator_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_assignments" ADD CONSTRAINT "moderator_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_assignments" ADD CONSTRAINT "moderator_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderator_assignments_active_user_key" ON "moderator_assignments" USING btree ("user_id") WHERE "moderator_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE FUNCTION public.lock_active_moderator(identity_provider text, identity_subject text)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT a.user_id
  FROM public.identities AS i
  JOIN public.moderator_assignments AS a ON a.user_id = i.user_id
  WHERE i.provider = identity_provider AND i.subject = identity_subject AND a.revoked_at IS NULL
  FOR SHARE OF i, a
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_active_moderator(text, text) FROM PUBLIC;
