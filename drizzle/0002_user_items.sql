CREATE TABLE "user_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"discogs_release_id" bigint NOT NULL,
	"list" text NOT NULL,
	"notes" text,
	"condition_media" text,
	"condition_sleeve" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_items_user_release_uq" UNIQUE("user_id","discogs_release_id"),
	CONSTRAINT "user_items_list_check" CHECK ("user_items"."list" in ('wishlist', 'collection'))
);
--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_items_user_list_added_idx" ON "user_items" USING btree ("user_id","list","added_at" DESC NULLS LAST);