-- 0005_backfill_workout_run_metrics.sql
--
-- Backfill workout_logs.distance_km + workout_logs.duration_sec from
-- run_sessions for historical rows that came through the home quick-log
-- sheet before app/(app)/home/actions.ts started copying those fields.
--
-- Symptom before this fix: weekly distance tile showed 0.0 km, RPE × Pace
-- chart had no pace points, Daily Activity had no active-time bars — all
-- because `logManualWorkout` wrote only rpe/footPain/notes and never the
-- distance / duration from the linked run_session.
--
-- This migration repairs the historical mismatch. The going-forward fix is
-- the code change in app/(app)/home/actions.ts; this script just makes the
-- analytics charts honest about runs the user already completed.
--
-- Idempotent: only touches rows where workout_logs.distance_km IS NULL.
-- Safe to re-run.

UPDATE workout_logs AS wl
SET
  distance_km  = rs.distance_km,
  duration_sec = rs.duration_sec
FROM run_sessions AS rs
WHERE rs.workout_log_id = wl.id
  AND rs.status         = 'completed'
  AND rs.distance_km IS NOT NULL
  AND rs.distance_km::numeric > 0
  AND rs.duration_sec > 0
  AND wl.distance_km IS NULL;

-- paceSecPerKm and rtl are GENERATED columns — they recompute automatically
-- once distance_km + duration_sec are populated. No further action needed.
