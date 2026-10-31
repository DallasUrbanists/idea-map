CREATE UNIQUE INDEX "ideas_id_author_contact_key" ON "ideas" USING btree ("id","author_contact_id");--> statement-breakpoint
ALTER TABLE "ownership_claims" ADD CONSTRAINT "ownership_claims_idea_id_contact_id_ideas_id_author_contact_id_fk" FOREIGN KEY ("idea_id","contact_id") REFERENCES "public"."ideas"("id","author_contact_id") ON DELETE no action ON UPDATE no action;
