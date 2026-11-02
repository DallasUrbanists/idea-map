CREATE TABLE "media_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"object_name" text NOT NULL,
	"generation" text NOT NULL,
	"content_type" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_previews_generation_format" CHECK ("media_previews"."generation" ~ '^[1-9][0-9]*$'),
	CONSTRAINT "media_previews_content_type" CHECK ("media_previews"."content_type" IN ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
ALTER TABLE "media_previews" ADD CONSTRAINT "media_previews_idea_id_revision_id_idea_revisions_idea_id_id_fk" FOREIGN KEY ("idea_id","revision_id") REFERENCES "public"."idea_revisions"("idea_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_previews_object_generation_key" ON "media_previews" USING btree ("object_name","generation");