-- 0000_00_schema_bootstrap.sql  (AF-6, 2026-11-05)
--
-- Creates the whole schema on an EMPTY database, so `pnpm db:migrate` alone can
-- build AdaptiveFit from scratch (CI, a restore, a new environment).
--
-- Why: 0000_initial_baseline.sql and later files ALTER tables that only
-- `drizzle-kit push` ever created, so on an empty database 0000 failed with
-- 'relation "coach_chat_messages" does not exist'. Nothing could rebuild
-- production's schema from this repo.
--
-- Safe on production: every statement is IF NOT EXISTS (tables, indexes) or
-- ignores duplicate_object (foreign keys), so on an existing database it does
-- nothing. Sorts before 0000_initial_baseline.sql ('0' < 'i').
--
-- Generated with `drizzle-kit export` from lib/db/schema.ts at the AF-6 commit,
-- then made idempotent. Later schema changes go in new numbered files as before;
-- do not edit this one.

CREATE TABLE IF NOT EXISTS "body_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"weight_kg" numeric(5, 2),
	"body_fat_pct" numeric(4, 1),
	"waist_cm" numeric(5, 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "coach_chat_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"params" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reversal" jsonb,
	"applied_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "coach_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"workout_log_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"locale" text,
	"model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "coach_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_log_id" uuid,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cold_start_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"raw_input" text NOT NULL,
	"extracted" jsonb NOT NULL,
	"recommended_level" integer,
	"accepted_level" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "feedback_sentiment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_log_id" uuid NOT NULL,
	"overall_sentiment" text NOT NULL,
	"symptoms" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"severity" integer NOT NULL,
	"ai_summary_en" text,
	"ai_summary_he" text,
	"gemini_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_sentiment_workout_log_id_unique" UNIQUE("workout_log_id")
);

CREATE TABLE IF NOT EXISTS "fit_daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"steps" integer,
	"distance_m" integer,
	"active_minutes" integer,
	"avg_hr" integer,
	"calories" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "fit_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fit_session_id" text NOT NULL,
	"activity_type" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"distance_m" integer,
	"avg_hr" integer,
	"max_hr" integer,
	"steps" integer,
	"calories" integer,
	"route" jsonb,
	"source_app" text,
	"user_classification" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text DEFAULT 'running' NOT NULL,
	"type" text NOT NULL,
	"target_value" numeric(10, 2) NOT NULL,
	"target_unit" text NOT NULL,
	"target_date" date NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"training_mix_pct" integer,
	"current_value" numeric(10, 2),
	"target_lifts" jsonb,
	"sessions_per_week" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "gps_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_session_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"accuracy_m" numeric(6, 2),
	"altitude_m" numeric(7, 2),
	"heart_rate" integer,
	"steps_delta" integer
);

CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "run_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_log_id" uuid,
	"client_run_id" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"distance_km" numeric(6, 3) DEFAULT '0' NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"avg_pace_sec_per_km" integer DEFAULT 0 NOT NULL,
	"splits" jsonb DEFAULT '[]'::jsonb,
	"source" text DEFAULT 'gps' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_sessions_workout_log_id_unique" UNIQUE("workout_log_id"),
	CONSTRAINT "run_sessions_client_run_id_unique" UNIQUE("client_run_id")
);

CREATE TABLE IF NOT EXISTS "strength_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_log_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise" text NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"reps" integer NOT NULL,
	"sets" integer DEFAULT 1 NOT NULL,
	"rpe" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "training_roadmap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"week_index" integer NOT NULL,
	"day_index" integer NOT NULL,
	"session_plan" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_level_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_level" integer DEFAULT 1 NOT NULL,
	"green_session_count" integer DEFAULT 0 NOT NULL,
	"freeze_active" boolean DEFAULT false NOT NULL,
	"freeze_reason" text,
	"last_evaluated_at" timestamp with time zone,
	"manual_override" boolean DEFAULT false NOT NULL,
	"manual_override_until" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"google_sub" text,
	"display_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);

CREATE TABLE IF NOT EXISTS "workout_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"distance_km" numeric(6, 2),
	"duration_sec" integer,
	"pace_sec_per_km" integer GENERATED ALWAYS AS (CASE WHEN duration_sec IS NOT NULL AND distance_km IS NOT NULL AND distance_km > 0
            THEN (duration_sec / distance_km)::int ELSE NULL END) STORED,
	"exercises" text[],
	"rpe" integer NOT NULL,
	"foot_pain" integer DEFAULT 0 NOT NULL,
	"other_pain" text,
	"notes_raw" text,
	"notes_locale" text,
	"rtl" numeric(8, 3) GENERATED ALWAYS AS (CASE WHEN type = 'run' AND distance_km IS NOT NULL
            THEN ROUND((distance_km * (rpe::numeric / 10))::numeric, 3)
            ELSE 0 END) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "workout_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_log_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coach_chat_actions" ADD CONSTRAINT "coach_chat_actions_chat_message_id_coach_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."coach_chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coach_chat_actions" ADD CONSTRAINT "coach_chat_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coach_chat_messages" ADD CONSTRAINT "coach_chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coach_chat_messages" ADD CONSTRAINT "coach_chat_messages_thread_id_coach_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coach_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coach_chat_messages" ADD CONSTRAINT "coach_chat_messages_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coach_threads" ADD CONSTRAINT "coach_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coach_threads" ADD CONSTRAINT "coach_threads_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cold_start_analysis" ADD CONSTRAINT "cold_start_analysis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "feedback_sentiment" ADD CONSTRAINT "feedback_sentiment_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fit_daily_metrics" ADD CONSTRAINT "fit_daily_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fit_sessions" ADD CONSTRAINT "fit_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "gps_points" ADD CONSTRAINT "gps_points_run_session_id_run_sessions_id_fk" FOREIGN KEY ("run_session_id") REFERENCES "public"."run_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "strength_logs" ADD CONSTRAINT "strength_logs_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "strength_logs" ADD CONSTRAINT "strength_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "training_roadmap" ADD CONSTRAINT "training_roadmap_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "training_roadmap" ADD CONSTRAINT "training_roadmap_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_level_state" ADD CONSTRAINT "user_level_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "workout_photos" ADD CONSTRAINT "workout_photos_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "body_metrics_user_date_idx" ON "body_metrics" USING btree ("user_id","date");

CREATE INDEX IF NOT EXISTS "coach_chat_actions_message_idx" ON "coach_chat_actions" USING btree ("chat_message_id");

CREATE INDEX IF NOT EXISTS "coach_chat_actions_user_status_idx" ON "coach_chat_actions" USING btree ("user_id","status");

CREATE INDEX IF NOT EXISTS "coach_chat_user_workout_idx" ON "coach_chat_messages" USING btree ("user_id","workout_log_id","created_at");

CREATE INDEX IF NOT EXISTS "coach_chat_messages_thread_idx" ON "coach_chat_messages" USING btree ("thread_id","created_at");

CREATE INDEX IF NOT EXISTS "coach_threads_user_last_message_idx" ON "coach_threads" USING btree ("user_id","last_message_at");

CREATE INDEX IF NOT EXISTS "coach_threads_user_workout_log_idx" ON "coach_threads" USING btree ("user_id","workout_log_id");

CREATE UNIQUE INDEX IF NOT EXISTS "fit_daily_metrics_user_date_idx" ON "fit_daily_metrics" USING btree ("user_id","date");

CREATE UNIQUE INDEX IF NOT EXISTS "fit_sessions_user_fit_session_idx" ON "fit_sessions" USING btree ("user_id","fit_session_id");

CREATE INDEX IF NOT EXISTS "fit_sessions_user_start_time_idx" ON "fit_sessions" USING btree ("user_id","start_time");

CREATE INDEX IF NOT EXISTS "gps_points_session_ts_idx" ON "gps_points" USING btree ("run_session_id","ts");

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_tokens_user_provider_idx" ON "oauth_tokens" USING btree ("user_id","provider");
