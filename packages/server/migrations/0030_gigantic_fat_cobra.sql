CREATE TABLE "registered_draft_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"slot" integer NOT NULL,
	"object_name" text NOT NULL,
	"generation" text,
	"digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registered_draft_media_slot" CHECK ("registered_draft_media"."slot" between 0 and 9),
	CONSTRAINT "registered_draft_media_revision" CHECK ("registered_draft_media"."revision" > 0),
	CONSTRAINT "registered_draft_media_evidence" CHECK (("registered_draft_media"."generation" IS NULL AND "registered_draft_media"."digest" IS NULL) OR ("registered_draft_media"."generation" IS NOT NULL AND "registered_draft_media"."digest" IS NOT NULL AND "registered_draft_media"."generation" ~ '^[1-9][0-9]*$' AND "registered_draft_media"."digest" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "registered_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"creation_key" uuid NOT NULL,
	"creation_digest" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"expected_media" integer NOT NULL,
	"frozen_manifest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registered_drafts_creation_digest" CHECK ("registered_drafts"."creation_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "registered_drafts_revision_positive" CHECK ("registered_drafts"."revision" > 0),
	CONSTRAINT "registered_drafts_media_count" CHECK ("registered_drafts"."expected_media" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "registered_draft_media" ADD CONSTRAINT "registered_draft_media_draft_id_registered_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."registered_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registered_draft_media_slot_key" ON "registered_draft_media" USING btree ("draft_id","revision","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_draft_media_object_key" ON "registered_draft_media" USING btree ("object_name");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_drafts_creation_key" ON "registered_drafts" USING btree ("provider","subject","creation_key");