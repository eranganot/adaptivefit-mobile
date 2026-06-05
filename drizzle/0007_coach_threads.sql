-- 0007_coach_threads.sql
--
-- Multi-thread chat coach: each "Start a new conversation" click creates its
-- own coach_threads row, so the user sees an empty UI instead of accumulated
-- history. Workout-anchored debriefs become threads too — one per workout —
-- so the existing "Chat about your latest workout" CTA still works.
--
-- Schema model:
--   coach_threads          one row per chat thread (general OR workout debrief)
--   coach_chat_messages    + thread_id FK to coach_threads
--
-- The old workout_log_id column on coach_chat_messages is KEPT (denormalised
-- for convenience and so legacy queries still compile during the deploy
-- window). It's no longer the thread identifier.
--
-- Migration safety:
--   The thread_id column is added nullable, the backfill populates it, a DO
--   block aborts the migration if any row is still NULL, and only then do we
--   add the NOT NULL + FK constraints. This makes the migration safe to
--   re-run and impossible to leave the DB half-migrated.
--
-- Idempotent: safe to re-run.

-- ── 1. New table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = general thread (no specific workout anchor)
  -- Non-NULL = workout debrief thread; SET NULL preserves the thread row if
  -- the workout is deleted, so the user's messages don't vanish.
  workout_log_id  UUID REFERENCES workout_logs(id) ON DELETE SET NULL,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coach_threads_user_last_message_idx
  ON coach_threads (user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS coach_threads_user_workout_log_idx
  ON coach_threads (user_id, workout_log_id);

-- ── 2. Nullable column on coach_chat_messages ──────────────────────
ALTER TABLE coach_chat_messages
  ADD COLUMN IF NOT EXISTS thread_id UUID;

-- ── 3. Backfill ────────────────────────────────────────────────────
-- (a) ONE general thread per user (collapses all NULL-workout_log_id
--     messages into a single backfilled thread per user).
INSERT INTO coach_threads (user_id, workout_log_id, title, created_at, last_message_at)
SELECT
  user_id,
  NULL,
  'General chat',
  MIN(created_at),
  MAX(created_at)
FROM coach_chat_messages
WHERE workout_log_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM coach_threads t
    WHERE t.user_id = coach_chat_messages.user_id
      AND t.workout_log_id IS NULL
  )
GROUP BY user_id;

-- (b) ONE workout thread per (user, workout_log_id) combo that has messages.
INSERT INTO coach_threads (user_id, workout_log_id, title, created_at, last_message_at)
SELECT
  user_id,
  workout_log_id,
  'Workout debrief',
  MIN(created_at),
  MAX(created_at)
FROM coach_chat_messages
WHERE workout_log_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM coach_threads t
    WHERE t.user_id = coach_chat_messages.user_id
      AND t.workout_log_id = coach_chat_messages.workout_log_id
  )
GROUP BY user_id, workout_log_id;

-- (c) Link every existing message to its new thread.
UPDATE coach_chat_messages m
SET thread_id = t.id
FROM coach_threads t
WHERE m.thread_id IS NULL
  AND m.user_id = t.user_id
  AND (
    (m.workout_log_id IS NULL AND t.workout_log_id IS NULL)
    OR m.workout_log_id = t.workout_log_id
  );

-- ── 4. Safety verify — abort if any message was missed ─────────────
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM coach_chat_messages WHERE thread_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Migration 0007 backfill left % messages without thread_id; aborting before NOT NULL is applied', orphan_count;
  END IF;
END $$;

-- ── 5. Enforce NOT NULL + FK + index ───────────────────────────────
ALTER TABLE coach_chat_messages
  ALTER COLUMN thread_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coach_chat_messages_thread_id_fkey'
  ) THEN
    ALTER TABLE coach_chat_messages
      ADD CONSTRAINT coach_chat_messages_thread_id_fkey
      FOREIGN KEY (thread_id) REFERENCES coach_threads(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS coach_chat_messages_thread_idx
  ON coach_chat_messages (thread_id, created_at);
