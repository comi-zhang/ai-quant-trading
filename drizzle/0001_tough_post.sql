CREATE TYPE "public"."backtest_run_status" AS ENUM('queued', 'running', 'paused', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idempotency_key" varchar(80) NOT NULL,
	"parent_run_id" integer,
	"status" "backtest_run_status" DEFAULT 'queued' NOT NULL,
	"params" jsonb NOT NULL,
	"data_version" varchar(16),
	"progress_processed" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_runs_user_idem" ON "backtest_runs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "backtest_runs_user_time" ON "backtest_runs" USING btree ("user_id","created_at");