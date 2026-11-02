CREATE TABLE "review_gates" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone,
	"wait_milliseconds" integer,
	"shortcut_requested" boolean DEFAULT false NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	CONSTRAINT "revision_assessments_deadline" CHECK (("revision_assessments"."deadline" IS NULL AND "revision_assessments"."wait_milliseconds" IS NULL AND NOT "revision_assessments"."shortcut_requested") OR ("revision_assessments"."deadline" IS NOT NULL AND "revision_assessments"."wait_milliseconds" IS NOT NULL AND "revision_assessments"."wait_milliseconds" BETWEEN 0 AND 86400000 AND "revision_assessments"."deadline" >= "revision_assessments"."received_at"))
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_gates" ADD CONSTRAINT "review_gates_revision_id_idea_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."idea_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_assessments" ADD CONSTRAINT "revision_assessments_revision_id_idea_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."idea_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revision_assessments_current_key" ON "revision_assessments" USING btree ("revision_id") WHERE "revision_assessments"."current";--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_delivery_generation_nonnegative" CHECK ("outbox"."delivery_generation" >= 0);