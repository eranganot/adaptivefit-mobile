-- 0004_fit_sessions_phase_8b.sql
--
-- Phase 8b — Health Connect ExerciseSession integration.
--
-- The `fit_sessions` table was built for Google Fit (Phase 3). Health Connect
-- maps to it cleanly but adds one piece of info Google Fit didn't surface:
-- the *source app* that originally recorded the session (Strava, Samsung
-- Health, Google Fit, etc.). We persist this so analytics + coach can tell
-- AdaptiveFit-native workouts (run_sessions) apart from sessions synced in
-- from external trackers via Health Connect.
--
-- Idempotent: safe to re-run.

-- 1. source_app -----------------------------------------------------------
-- The Health Connect ExerciseSessionRecord exposes the source via
-- metadata.dataOrigin.packageName. We store the raw package name so we can
-- map it to a display label client-side ("Strava", "Samsung Health", etc.)
-- without ever guessing. NULL for rows imported pre-Phase-8b.
ALTER TABLE fit_sessions
  ADD COLUMN IF NOT EXISTS source_app TEXT;

-- Index for "show me sessions from X" type filters in analytics.
CREATE INDEX IF NOT EXISTS fit_sessions_user_source_app_idx
  ON fit_sessions (user_id, source_app)
  WHERE source_app IS NOT NULL;
