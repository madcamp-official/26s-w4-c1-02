ALTER TABLE "collections" ADD COLUMN "forked_from" uuid;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_forked_from_collections_id_fk" FOREIGN KEY ("forked_from") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_listed_idx" ON "collections" USING btree ("listed","visibility");--> statement-breakpoint
CREATE INDEX "collections_forked_from_idx" ON "collections" USING btree ("forked_from");