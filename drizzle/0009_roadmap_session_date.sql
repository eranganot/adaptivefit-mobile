-- 0009_roadmap_session_date.sql  (AF-B6, 2026-11-05)
--
-- training_roadmap.week_index / day_index are relative to "this Sunday" at the
-- moment a row was written. Auto rows are rewritten on every regeneration, but
-- manual, coach-proposed, completed and modified rows survive it, and their
-- indexes were never shifted when the week rolled over: last week's session
-- kept week_index 0 and showed as this week's, and the coach's "upcoming
-- sessions" list (LIMIT 8) filled up with them.
--
-- Fix: every row carries its calendar date. A trigger stamps session_date from
-- the indexes whenever a writer sets them (no app writer had to change), and
-- lib/roadmap/anchor.ts re-derives the indexes from session_date for the
-- current week before the roadmap is read. Week anchor: Sunday, UTC - the same
-- as startOfWeekSunday() on the Railway server (TZ=UTC).
--
-- Idempotent. Backfill uses created_at, the week the indexes were relative to
-- when the row was inserted (a session moved later was relative to the week of
-- the move; that is not recorded, so such a row may land a week off once).

ALTER TABLE training_roadmap ADD COLUMN IF NOT EXISTS session_date DATE;

CREATE OR REPLACE FUNCTION af_week_sunday(ts TIMESTAMPTZ) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((ts AT TIME ZONE 'UTC')::date - EXTRACT(DOW FROM (ts AT TIME ZONE 'UTC'))::int)
$$;

UPDATE training_roadmap
   SET session_date = af_week_sunday(created_at) + week_index * 7 + day_index
 WHERE session_date IS NULL;

CREATE OR REPLACE FUNCTION af_roadmap_stamp_session_date() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.session_date IS NULL THEN
      NEW.session_date := af_week_sunday(now()) + NEW.week_index * 7 + NEW.day_index;
    END IF;
  ELSIF NEW.week_index IS DISTINCT FROM OLD.week_index OR NEW.day_index IS DISTINCT FROM OLD.day_index THEN
    -- A writer moved the session (indexes relative to this week), unless it is
    -- the re-anchor itself, which also sets session_date to the same date.
    IF NEW.session_date IS NOT DISTINCT FROM OLD.session_date THEN
      NEW.session_date := af_week_sunday(now()) + NEW.week_index * 7 + NEW.day_index;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS training_roadmap_session_date ON training_roadmap;
CREATE TRIGGER training_roadmap_session_date
  BEFORE INSERT OR UPDATE ON training_roadmap
  FOR EACH ROW EXECUTE FUNCTION af_roadmap_stamp_session_date();

CREATE INDEX IF NOT EXISTS training_roadmap_user_session_date_idx
  ON training_roadmap (user_id, session_date);
