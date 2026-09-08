CREATE TYPE "public"."account_mode" AS ENUM('paper', 'live');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."action" AS ENUM('buy', 'sell', 'hold');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_accept', 'accepted', 'rejected', 'partial_filled', 'filled', 'cancelling', 'cancelled', 'expired', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."time_in_force" AS ENUM('day', 'gtc');--> statement-breakpoint
CREATE TABLE "account_cash" (
	"account_id" integer PRIMARY KEY NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"cash" numeric(18, 2) DEFAULT '100000' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"broker" varchar(32) DEFAULT 'longbridge' NOT NULL,
	"mode" "account_mode" DEFAULT 'paper' NOT NULL,
	"label" varchar(64) DEFAULT 'default' NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"action" "action" NOT NULL,
	"confidence" numeric(5, 2),
	"composite_score" numeric(5, 2),
	"fundamental_score" numeric(5, 2),
	"sentiment_score" numeric(5, 2),
	"technical_score" numeric(5, 2),
	"reasoning" text,
	"inputs" jsonb,
	"data_quality" varchar(16) DEFAULT 'ok' NOT NULL,
	"model_version" varchar(64),
	"job_run_id" integer,
	"executed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"account_id" integer,
	"event_type" varchar(64) NOT NULL,
	"entity_type" varchar(32),
	"entity_id" varchar(64),
	"request_id" varchar(64),
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"broker_trade_id" varchar(64) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"side" "side" NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"trade_done_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(64) NOT NULL,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"lease_owner" varchar(64),
	"lease_expires_at" timestamp,
	"attempt" integer DEFAULT 1 NOT NULL,
	"stats" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"client_order_id" varchar(64) NOT NULL,
	"broker_order_id" varchar(64),
	"symbol" varchar(20) NOT NULL,
	"side" "side" NOT NULL,
	"order_type" "order_type" NOT NULL,
	"time_in_force" time_in_force DEFAULT 'day' NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"limit_price" numeric(18, 4),
	"status" "order_status" DEFAULT 'pending_accept' NOT NULL,
	"filled_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"avg_fill_price" numeric(18, 4),
	"mode" "account_mode" DEFAULT 'paper' NOT NULL,
	"ai_decision_id" integer,
	"reject_reason" text,
	"risk_snapshot" jsonb,
	"submitted_at" timestamp,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"available_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"avg_price" numeric(18, 4) NOT NULL,
	"current_price" numeric(18, 4),
	"market_value" numeric(18, 2),
	"unrealized_pnl" numeric(18, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"max_position_size" numeric(18, 2) NOT NULL,
	"max_total_exposure" numeric(18, 2) NOT NULL,
	"max_order_quantity" integer DEFAULT 1000 NOT NULL,
	"max_daily_trades" integer DEFAULT 20 NOT NULL,
	"max_daily_loss" numeric(18, 2) DEFAULT '2000' NOT NULL,
	"min_account_balance" numeric(18, 2) DEFAULT '5000' NOT NULL,
	"stop_loss_percent" numeric(5, 2) NOT NULL,
	"take_profit_percent" numeric(5, 2) NOT NULL,
	"enable_auto_trading" boolean DEFAULT false NOT NULL,
	"trading_halted" boolean DEFAULT false NOT NULL,
	"halt_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "risk_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"fill_id" integer,
	"symbol" varchar(20) NOT NULL,
	"side" "side" NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"realized_pnl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"executed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"name" text,
	"market" varchar(10) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_cash" ADD CONSTRAINT "account_cash_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_config" ADD CONSTRAINT "risk_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_fill_id_fills_id_fk" FOREIGN KEY ("fill_id") REFERENCES "public"."fills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_broker_mode_label" ON "accounts" USING btree ("user_id","broker","mode","label");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_decisions_user_time" ON "ai_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_decisions_symbol" ON "ai_decisions" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "audit_user_time" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_type_time" ON "audit_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fills_broker_trade_id" ON "fills" USING btree ("broker_trade_id");--> statement-breakpoint
CREATE INDEX "fills_order" ON "fills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "job_runs_name_status" ON "job_runs" USING btree ("job_name","status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_account_clientid" ON "orders" USING btree ("account_id","client_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_broker_id" ON "orders" USING btree ("broker_order_id");--> statement-breakpoint
CREATE INDEX "orders_account_status" ON "orders" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "orders_symbol" ON "orders" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_account_symbol" ON "positions" USING btree ("account_id","symbol");--> statement-breakpoint
CREATE INDEX "trades_account_time" ON "trades" USING btree ("account_id","executed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_user_symbol" ON "watchlist" USING btree ("user_id","symbol");