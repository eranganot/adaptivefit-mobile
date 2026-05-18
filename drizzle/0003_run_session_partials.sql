-- 0003_run_session_partials.sql
--
-- Adds support for in-progress (partial) run_sessions that get incrementally
-- updated by the 15-second client flush, so a phone crash / app kill mid-run
-- still leaves a recoverable row with all GPS points up to the last flush.
--
-- Changes:
--   1. New `client_run_id` column — stable UUID generated on the client when
--      a run starts. Made UNIQUE so appendRunPoints / endRunSession can
--      idempotently upsert by it. Nullable (backfill for old rows would be
--      meaningless).
--   2. New `status` column — 'in_progress' | 'completed'. Existing rows are
--      already finished, so they default to 'completed'.
--   3. `ended_at` made NULLABLE — only set when the user taps End. While the
--      run is in_progress this is NULL.
--   4. `splits`, `distance_km`, `duration_sec`, `avg_pace_sec_per_km` given
--      defaults so a fresh in-progress row can be inserted before we have
--      any GPS data.
--   5. New `updated_at` column for cheap "last flush time" tracking.
--
-- Idempotent: safe to re-run on every deploy. Uses IF NOT EXISTS and
-- conditional ALTERs.

-- 1. client_run_id ---------------------------------------------------------
ALTER TABLE run_sessions
  ADD COLUMN IF NOT EXISTS client_run_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname  = 'run_sessions_client_run_id_unique'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX run_sessions_client_run_id_unique
             ON run_sessions (client_run_id)
             WHERE client_run_id IS NOT NULL';
  END IF;
END $$;

-- 2. status ---------------------------------------------------------------
ALTER TABLE run_sessions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';

-- Replace any prior CHECK if name collides; otherwise add a fresh one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'run_sessions_status_check'
  ) THEN
    EXECUTE 'ALTER TABLE run_sessions
             ADD CONSTRAINT run_sessions_status_check
             CHECK (status IN (''in_progress'', ''completed''))';
  END IF;
END $$;

-- 3. ended_at nullable ----------------------------------------------------
ALTER TABLE run_sessions
  ALTER COLUMN ended_at DROP NOT NULL;

-- 4. defaults for numeric columns so partial inserts work -----------------
ALTER TABLE run_sessions
  ALTER COLUMN distance_km          SET DEFAULT 0,
  ALTER COLUMN duration_sec         SET DEFAULT 0,
  ALTER COLUMN avg_pace_sec_per_km  SET DEFAULT 0;

-- splits goes nullable + default empty jsonb array
ALTER TABLE run_sessions
  ALTER COLUMN splits DROP NOT NULL,
  ALTER COLUMN splits SET DEFAULT '[]'::jsonb;

-- 5. updated_at -----------------------------------------------------------
ALTER TABLE run_sessions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Helpful index for "find a user's in-progress run" lookups.
CREATE INDEX IF NOT EXISTS run_sessions_user_status_idx
  ON run_sessions (user_id, status);
