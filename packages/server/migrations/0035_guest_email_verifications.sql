CREATE TABLE "guest_email_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idea_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"secret_digest" text NOT NULL,
	"email_mac" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "guest_email_verifications_digests" CHECK ("guest_email_verifications"."secret_digest" ~ '^[0-9a-f]{64}$' AND "guest_email_verifications"."email_mac" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "guest_email_verifications_expiry" CHECK ("guest_email_verifications"."expires_at" > "guest_email_verifications"."created_at")
);
--> statement-breakpoint
ALTER TABLE "guest_email_verifications" ADD CONSTRAINT "guest_email_verifications_idea_id_contact_id_ideas_id_author_contact_id_fk" FOREIGN KEY ("idea_id","contact_id") REFERENCES "public"."ideas"("id","author_contact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_email_verifications_digest_key" ON "guest_email_verifications" USING btree ("secret_digest");--> statement-breakpoint
CREATE INDEX "guest_email_verifications_idea_idx" ON "guest_email_verifications" USING btree ("idea_id");