CREATE TABLE "moderator_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"requested_revision_id" uuid NOT NULL,
	"requested_assessment_id" text,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"resolved_revision_id" uuid,
	"resolved_assessment_id" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	CONSTRAINT "moderator_change_requests_reason" CHECK (length(trim("moderator_change_requests"."reason")) > 0 AND octet_length("moderator_change_requests"."reason") <= 1000),
	CONSTRAINT "moderator_change_requests_resolution" CHECK (("moderator_change_requests"."resolved_at" IS NULL AND "moderator_change_requests"."resolved_by" IS NULL AND "moderator_change_requests"."resolved_revision_id" IS NULL AND "moderator_change_requests"."resolved_assessment_id" IS NULL AND "moderator_change_requests"."resolution_reason" IS NULL) OR ("moderator_change_requests"."resolved_at" IS NOT NULL AND "moderator_change_requests"."resolved_by" IS NOT NULL AND "moderator_change_requests"."resolved_revision_id" IS NOT NULL AND "moderator_change_requests"."resolution_reason" IS NOT NULL AND length(trim("moderator_change_requests"."resolution_reason")) > 0 AND octet_length("moderator_change_requests"."resolution_reason") <= 1000))
);
--> statement-breakpoint
ALTER TABLE "moderator_change_requests" ADD CONSTRAINT "moderator_change_requests_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_change_requests" ADD CONSTRAINT "moderator_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_change_requests" ADD CONSTRAINT "moderator_change_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_change_requests" ADD CONSTRAINT "moderator_change_requests_idea_id_requested_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","requested_revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_change_requests" ADD CONSTRAINT "moderator_change_requests_requested_assessment_id_requested_revision_id_revision_assessments_id_revision_id_fk" FOREIGN KEY ("requested_assessment_id","requested_revision_id") REFERENCES "public"."revision_assessments"("id","revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_change_requests" ADD CONSTRAINT "moderator_change_requests_idea_id_resolved_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","resolved_revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_change_requests" ADD CONSTRAINT "moderator_change_requests_resolved_assessment_id_resolved_revision_id_revision_assessments_id_revision_id_fk" FOREIGN KEY ("resolved_assessment_id","resolved_revision_id") REFERENCES "public"."revision_assessments"("id","revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderator_change_requests_active_idea_key" ON "moderator_change_requests" USING btree ("idea_id") WHERE "moderator_change_requests"."resolved_at" IS NULL;