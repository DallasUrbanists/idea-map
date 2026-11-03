CREATE TABLE "registered_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"draft_revision" integer NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"submission_key" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"idea_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"terms_text" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registered_submissions_revision_positive" CHECK ("registered_submissions"."draft_revision" > 0),
	CONSTRAINT "registered_submissions_digest" CHECK ("registered_submissions"."request_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "registered_submissions" ADD CONSTRAINT "registered_submissions_draft_id_registered_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."registered_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registered_submissions" ADD CONSTRAINT "registered_submissions_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registered_submissions" ADD CONSTRAINT "registered_submissions_idea_id_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registered_submissions_key" ON "registered_submissions" USING btree ("provider","subject","submission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_submissions_draft_key" ON "registered_submissions" USING btree ("draft_id","draft_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_submissions_revision_key" ON "registered_submissions" USING btree ("revision_id");