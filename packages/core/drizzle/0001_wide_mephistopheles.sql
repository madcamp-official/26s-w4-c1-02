CREATE TABLE "notification_log" (
	"channel_key" text NOT NULL,
	"item_id" uuid NOT NULL,
	"view_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_channel_key_item_id_sent_at_pk" PRIMARY KEY("channel_key","item_id","sent_at")
);
--> statement-breakpoint
CREATE TABLE "view_matches" (
	"view_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_matches_view_id_item_id_pk" PRIMARY KEY("view_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"where_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns_json" jsonb,
	"notify_json" jsonb,
	"owner_id" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "views_collection_slug_uq" UNIQUE("collection_id","slug")
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_matches" ADD CONSTRAINT "view_matches_view_id_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_matches" ADD CONSTRAINT "view_matches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_log_item_sent_idx" ON "notification_log" USING btree ("item_id","sent_at");--> statement-breakpoint
CREATE INDEX "views_owner_idx" ON "views" USING btree ("owner_id");