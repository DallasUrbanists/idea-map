CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."publication_state" AS ENUM('private', 'approved', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('waiting', 'queued', 'reviewing', 'escalated', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "approved_revisions" (
	"idea_id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_email" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_submission_counters" (
	"browser_id" text PRIMARY KEY NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"review_state" "review_state" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"author_contact_id" uuid NOT NULL,
	"publication_state" "publication_state" DEFAULT 'private' NOT NULL,
	"location" geography(point, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"actor_id" uuid,
	"state" "review_state" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approved_revisions" ADD CONSTRAINT "approved_revisions_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idea_revisions_idea_id_key" ON "idea_revisions" USING btree ("idea_id","id");--> statement-breakpoint
ALTER TABLE "approved_revisions" ADD CONSTRAINT "approved_revisions_idea_id_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_revisions" ADD CONSTRAINT "idea_revisions_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_author_contact_id_contacts_id_fk" FOREIGN KEY ("author_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_revision_id_idea_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."idea_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_revision_id_idea_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."idea_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_claims" ADD CONSTRAINT "ownership_claims_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_claims" ADD CONSTRAINT "ownership_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_claims" ADD CONSTRAINT "ownership_claims_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_idea_idx" ON "audit_events" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_revisions_version_key" ON "idea_revisions" USING btree ("idea_id","version");--> statement-breakpoint

CREATE INDEX "ideas_owner_idx" ON "ideas" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ideas_author_contact_idx" ON "ideas" USING btree ("author_contact_id");--> statement-breakpoint
CREATE INDEX "ideas_location_gist_idx" ON "ideas" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject_key" ON "identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "identities_user_idx" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_revision_idx" ON "jobs" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "moderation_events_revision_idx" ON "moderation_events" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_job_key" ON "outbox" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "outbox_published_idx" ON "outbox" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_claims_idea_key" ON "ownership_claims" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "ownership_claims_user_idx" ON "ownership_claims" USING btree ("user_id");