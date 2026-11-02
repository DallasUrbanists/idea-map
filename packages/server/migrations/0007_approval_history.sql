CREATE TABLE "approval_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"excluded" boolean NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_records" (
	"idea_id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"verified_for_trust" boolean DEFAULT false NOT NULL,
	"excluded_for_violation" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_corrections" ADD CONSTRAINT "approval_corrections_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_corrections" ADD CONSTRAINT "approval_corrections_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_idea_id_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_corrections_idea_idx" ON "approval_corrections" USING btree ("idea_id");--> statement-breakpoint
-- Existing pointers do not prove whether an approval was reversed for a violation.
INSERT INTO "approval_records" ("idea_id", "revision_id", "verified_for_trust")
SELECT a."idea_id", a."revision_id", false FROM "approved_revisions" a
JOIN "idea_revisions" r ON r."idea_id" = a."idea_id" AND r."id" = a."revision_id"
WHERE r."review_state" = 'approved';
