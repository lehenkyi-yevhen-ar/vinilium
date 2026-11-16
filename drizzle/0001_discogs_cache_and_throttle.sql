CREATE TABLE "discogs_bucket" (
	"id" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"capacity" integer NOT NULL,
	"refill_per_sec" double precision NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"observed_limit" integer,
	"observed_remaining" integer,
	"observed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "discogs_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "discogs_cache_expires_at_idx" ON "discogs_cache" USING btree ("expires_at");