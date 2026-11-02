CREATE TABLE "moderator_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"placed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "moderator_holds_reason" CHECK (length(trim("moderator_holds"."reason")) > 0 AND octet_length("moderator_holds"."reason") <= 1000),
	CONSTRAINT "moderator_holds_release_fields" CHECK (("moderator_holds"."released_at" IS NULL AND "moderator_holds"."released_by" IS NULL AND "moderator_holds"."release_reason" IS NULL) OR ("moderator_holds"."released_at" IS NOT NULL AND "moderator_holds"."released_by" IS NOT NULL AND "moderator_holds"."release_reason" IS NOT NULL AND length(trim("moderator_holds"."release_reason")) > 0 AND octet_length("moderator_holds"."release_reason") <= 1000))
);
--> statement-breakpoint
ALTER TABLE "moderator_holds" ADD CONSTRAINT "moderator_holds_revision_id_idea_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."idea_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_holds" ADD CONSTRAINT "moderator_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_holds" ADD CONSTRAINT "moderator_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderator_holds_active_revision_key" ON "moderator_holds" USING btree ("revision_id") WHERE "moderator_holds"."released_at" IS NULL;