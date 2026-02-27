-- Users table
CREATE TABLE "users" (
  "id" serial PRIMARY KEY,
  "open_id" varchar(64) NOT NULL UNIQUE,
  "name" text,
  "email" varchar(320),
  "login_method" varchar(64),
  "role" varchar(20) NOT NULL DEFAULT 'user',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "last_signed_in" timestamp NOT NULL DEFAULT now()
);

-- Watchlist table
CREATE TABLE "watchlist" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "symbol" varchar(20) NOT NULL,
  "name" text,
  "market" varchar(10) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Positions table
CREATE TABLE "positions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "symbol" varchar(20) NOT NULL,
  "quantity" decimal(18,8) NOT NULL,
  "avg_price" decimal(18,4) NOT NULL,
  "current_price" decimal(18,4),
  "market_value" decimal(18,2),
  "unrealized_pnl" decimal(18,2),
  "unrealized_pnl_percent" decimal(10,4),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Trades table
CREATE TABLE "trades" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "symbol" varchar(20) NOT NULL,
  "side" varchar(10) NOT NULL,
  "order_type" varchar(10) NOT NULL,
  "quantity" decimal(18,8) NOT NULL,
  "price" decimal(18,4) NOT NULL,
  "total_amount" decimal(18,2) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "order_id" varchar(100),
  "executed_at" timestamp,
  "ai_decision_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- AI Decisions table
CREATE TABLE "ai_decisions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "symbol" varchar(20) NOT NULL,
  "action" varchar(10) NOT NULL,
  "confidence" decimal(5,2),
  "reasoning" text,
  "fundamental_score" decimal(5,2),
  "sentiment_score" decimal(5,2),
  "technical_score" decimal(5,2),
  "fundamental_data" text,
  "sentiment_data" text,
  "technical_data" text,
  "recommended_price" decimal(18,4),
  "recommended_quantity" decimal(18,8),
  "executed" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Risk Config table
CREATE TABLE "risk_config" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL UNIQUE,
  "max_position_size" decimal(18,2) NOT NULL,
  "max_total_exposure" decimal(18,2) NOT NULL,
  "stop_loss_percent" decimal(5,2) NOT NULL,
  "take_profit_percent" decimal(5,2) NOT NULL,
  "max_daily_trades" integer NOT NULL,
  "enable_auto_trading" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- API Keys table
CREATE TABLE "api_keys" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "provider" varchar(50) NOT NULL,
  "key_name" varchar(100) NOT NULL,
  "key_value" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
