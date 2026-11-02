CREATE TABLE "moderator_escalation_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hold_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"previous_owner_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"assessment_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderator_escalation_transfers_sequence" CHECK ("moderator_escalation_transfers"."sequence" > 0),
	CONSTRAINT "moderator_escalation_transfers_distinct" CHECK ("moderator_escalation_transfers"."previous_owner_id" <> "moderator_escalation_transfers"."owner_id"),
	CONSTRAINT "moderator_escalation_transfers_reason" CHECK (length(trim("moderator_escalation_transfers"."reason")) > 0 AND octet_length("moderator_escalation_transfers"."reason") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "moderator_escalation_transfers" ADD CONSTRAINT "moderator_escalation_transfers_hold_id_moderator_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."moderator_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_escalation_transfers" ADD CONSTRAINT "moderator_escalation_transfers_previous_owner_id_users_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_escalation_transfers" ADD CONSTRAINT "moderator_escalation_transfers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_escalation_transfers" ADD CONSTRAINT "moderator_escalation_transfers_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_escalation_transfers" ADD CONSTRAINT "moderator_escalation_transfers_revision_id_idea_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."idea_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderator_escalation_transfers" ADD CONSTRAINT "moderator_escalation_transfers_assessment_id_revision_id_revision_assessments_id_revision_id_fk" FOREIGN KEY ("assessment_id","revision_id") REFERENCES "public"."revision_assessments"("id","revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderator_escalation_transfers_sequence_key" ON "moderator_escalation_transfers" USING btree ("hold_id","sequence");