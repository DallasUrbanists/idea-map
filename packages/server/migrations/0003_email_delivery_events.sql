CREATE TABLE "email_delivery_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_delivery_events_email_idx" ON "email_delivery_events" USING btree ("email_id","occurred_at");