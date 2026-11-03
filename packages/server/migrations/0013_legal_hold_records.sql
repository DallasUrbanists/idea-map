CREATE TABLE "legal_hold_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"authority" text NOT NULL,
	"authorization_reference" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "legal_hold_assignments_authority" CHECK ("legal_hold_assignments"."authority" IN ('executive_director','delegate')),
	CONSTRAINT "legal_hold_assignments_reference" CHECK (length(trim("legal_hold_assignments"."authorization_reference")) > 0 AND octet_length("legal_hold_assignments"."authorization_reference") <= 300),
	CONSTRAINT "legal_hold_assignments_revocation" CHECK (("legal_hold_assignments"."revoked_at" IS NULL AND "legal_hold_assignments"."revoked_by" IS NULL AND "legal_hold_assignments"."revoke_reason" IS NULL) OR ("legal_hold_assignments"."revoked_at" IS NOT NULL AND "legal_hold_assignments"."revoked_by" IS NOT NULL AND "legal_hold_assignments"."revoke_reason" IS NOT NULL AND length(trim("legal_hold_assignments"."revoke_reason")) > 0 AND octet_length("legal_hold_assignments"."revoke_reason") <= 1000))
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"case_reference" text NOT NULL,
	"reason" text NOT NULL,
	"placed_by" uuid NOT NULL,
	"placement_authority_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"release_authority_id" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"legal_review_reference" text,
	CONSTRAINT "legal_holds_case_reference" CHECK (length(trim("legal_holds"."case_reference")) > 0 AND octet_length("legal_holds"."case_reference") <= 300),
	CONSTRAINT "legal_holds_reason" CHECK (length(trim("legal_holds"."reason")) > 0 AND octet_length("legal_holds"."reason") <= 1000),
	CONSTRAINT "legal_holds_release" CHECK (("legal_holds"."released_at" IS NULL AND "legal_holds"."released_by" IS NULL AND "legal_holds"."release_authority_id" IS NULL AND "legal_holds"."release_reason" IS NULL AND "legal_holds"."legal_review_reference" IS NULL) OR ("legal_holds"."released_at" IS NOT NULL AND "legal_holds"."released_by" IS NOT NULL AND "legal_holds"."release_authority_id" IS NOT NULL AND "legal_holds"."release_reason" IS NOT NULL AND length(trim("legal_holds"."release_reason")) > 0 AND octet_length("legal_holds"."release_reason") <= 1000 AND ("legal_holds"."legal_review_reference" IS NULL OR (length(trim("legal_holds"."legal_review_reference")) > 0 AND octet_length("legal_holds"."legal_review_reference") <= 300))))
);
--> statement-breakpoint
ALTER TABLE "legal_hold_assignments" ADD CONSTRAINT "legal_hold_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_hold_assignments" ADD CONSTRAINT "legal_hold_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_hold_assignments" ADD CONSTRAINT "legal_hold_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placement_authority_id_legal_hold_assignments_id_fk" FOREIGN KEY ("placement_authority_id") REFERENCES "public"."legal_hold_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_release_authority_id_legal_hold_assignments_id_fk" FOREIGN KEY ("release_authority_id") REFERENCES "public"."legal_hold_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_hold_assignments_active_user_key" ON "legal_hold_assignments" USING btree ("user_id") WHERE "legal_hold_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_holds_active_case_idea_key" ON "legal_holds" USING btree ("idea_id","case_reference") WHERE "legal_holds"."released_at" IS NULL;