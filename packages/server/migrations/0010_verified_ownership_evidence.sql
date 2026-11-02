ALTER TABLE "ownership_claims" ADD COLUMN "verified_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "ownership_claims" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_id_user_key" ON "identities" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "ownership_claims" ADD CONSTRAINT "ownership_claims_verified_identity_id_user_id_identities_id_user_id_fk" FOREIGN KEY ("verified_identity_id","user_id") REFERENCES "public"."identities"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_claims" ADD CONSTRAINT "ownership_claims_verified_pair" CHECK (("ownership_claims"."verified_identity_id" IS NULL) = ("ownership_claims"."verified_at" IS NULL));