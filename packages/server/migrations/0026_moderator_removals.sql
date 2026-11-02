CREATE TABLE "moderator_removals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"reason" text NOT NULL,
	"projection_job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderator_removals_classification" CHECK ("moderator_removals"."classification" IN ('violation','other')),
	CONSTRAINT "moderator_removals_reason" CHECK (length(trim("moderator_removals"."reason")) > 0 AND octet_length("moderator_removals"."reason") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "moderator_removals" ADD CONSTRAINT "moderator_removals_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_removals" ADD CONSTRAINT "moderator_removals_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_removals" ADD CONSTRAINT "moderator_removals_projection_job_id_jobs_id_fk" FOREIGN KEY ("projection_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_removals" ADD CONSTRAINT "moderator_removals_idea_id_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;