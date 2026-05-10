-- 0000_initial_baseline.sql
--
-- Idempotent baseline migration. Adds the schema columns that were declared in
-- lib/db/schema.ts but never reached production because `drizzle-kit push`
-- was hanging in Railway's non-TTY environment.
--
-- These ALTER TABLE statements are safe to re-run on every deploy.
--
-- Future schema changes: add a new numbered .sql file in this directory with
-- IF NOT EXISTS / IF EXISTS guards.

-- coach_chat_messages.model_used  (Round 6 Deploy 1)
-- Stamps which Gemini model produced each assistant message — useful for
-- diagnosing quality regressions across model swaps.
ALTER TABLE coach_chat_messages
  ADD COLUMN IF NOT EXISTS model_used TEXT;

-- training_roadmap.source  (Round 6 Fix B — non-destructive regenerator)
-- Tracks the origin of each roadmap row so the auto-regenerator can leave
-- manually-added or coach-proposed rows alone instead of nuking everything.
--   'auto'           : created by regenerateRoadmapForUser
--   'manual'         : added by the user via the roadmap UI
--   'coach_proposal' : applied from a chat-coach proposal (Deploy 2)
ALTER TABLE training_roadmap
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto';
