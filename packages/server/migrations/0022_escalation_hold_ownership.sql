DROP INDEX "moderator_holds_active_revision_key";--> statement-breakpoint
ALTER TABLE "moderator_holds" ADD COLUMN "kind" text DEFAULT 'hold' NOT NULL;--> statement-breakpoint
ALTER TABLE "moderator_holds" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "moderator_holds" ADD CONSTRAINT "moderator_holds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderator_holds_active_revision_kind_key" ON "moderator_holds" USING btree ("revision_id","kind") WHERE "moderator_holds"."released_at" IS NULL;--> statement-breakpoint
ALTER TABLE "moderator_holds" ADD CONSTRAINT "moderator_holds_kind_owner" CHECK (("moderator_holds"."kind" = 'hold' AND "moderator_holds"."owner_id" IS NULL) OR ("moderator_holds"."kind" = 'escalation' AND "moderator_holds"."owner_id" IS NOT NULL));