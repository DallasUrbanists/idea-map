ALTER TABLE "jobs" ADD COLUMN "assessment_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "assessment_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "dispatch_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_assessment_kind_key" ON "jobs" USING btree ("kind","revision_id","assessment_id") WHERE "jobs"."assessment_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assessment_identity" CHECK (("jobs"."assessment_id" IS NULL AND "jobs"."assessment_received_at" IS NULL) OR ("jobs"."assessment_id" IS NOT NULL AND "jobs"."assessment_received_at" IS NOT NULL AND "jobs"."revision_id" IS NOT NULL AND "jobs"."scheduled_at" IS NOT NULL AND "jobs"."scheduled_at" >= "jobs"."assessment_received_at"));--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_dispatch_attempts_range" CHECK ("outbox"."dispatch_attempts" between 0 and 5);--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_lease_pair" CHECK (("outbox"."lease_token" IS NULL) = ("outbox"."lease_until" IS NULL));