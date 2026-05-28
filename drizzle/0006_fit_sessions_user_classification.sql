-- 0006_fit_sessions_user_classification.sql
--
-- Phase 8b polish — distinguish "training" from "casual activity" on external
-- HC sessions (Strava walks, Samsung Health auto-detected activity, etc.).
--
-- The chart and chat coach were treating every external session as a workout.
-- A 1km morning walk is not training. A long brisk walk might be — the user
-- knows; the automatic classifier doesn't, reliably. So:
--   - The auto classifier (clearly_training / clearly_activity / ambiguous)
--     handles the obvious cases.
--   - Ambiguous sessions get surfaced to the user (Home card + chat coach
--     question). Their answer persists here.
--   - The chart and coach read this column instead of re-classifying every
--     time.
--
-- Idempotent: safe to re-run.

-- Possible values: 'training', 'activity', or NULL (= not yet classified by
-- the user; the auto classifier's bucket applies).
ALTER TABLE fit_sessions
  ADD COLUMN IF NOT EXISTS user_classification TEXT
    CHECK (user_classification IN ('training', 'activity'));

-- Index for the "show me pending classifications" query — common path from
-- the Home card and the chat coach prompt. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS fit_sessions_pending_classification_idx
  ON fit_sessions (user_id, start_time DESC)
  WHERE user_classification IS NULL;
