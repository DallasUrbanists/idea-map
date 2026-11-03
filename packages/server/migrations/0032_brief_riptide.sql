CREATE TABLE "public_access_gate" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"is_open" boolean DEFAULT false NOT NULL,
	CONSTRAINT "public_access_gate_singleton" CHECK ("public_access_gate"."singleton" = true)
);
--> statement-breakpoint
INSERT INTO public.public_access_gate (singleton, is_open) VALUES (true, false);
--> statement-breakpoint
REVOKE ALL ON TABLE public.public_access_gate FROM PUBLIC;
