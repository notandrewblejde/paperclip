ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "routines_company_idempotency_key_uq" ON "routines" USING btree ("company_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
