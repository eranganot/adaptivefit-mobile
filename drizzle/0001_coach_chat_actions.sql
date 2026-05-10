-- 0001_coach_chat_actions.sql
--
-- Round 6 Deploy 2 — propose-and-approve plan changes from chat.
--
-- When the coach emits a function call (a proposal), it's stored as 'pending'.
-- Nothing changes in the plan until the user explicitly taps Approve.
-- Approved actions can be reverted via Undo (using the reversal payload).
--
-- Idempotent: safe to re-run on every deploy.

CREATE TABLE IF NOT EXISTS coach_chat_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_message_id UUID NOT NULL REFERENCES coach_chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (
    action_type IN ('soften_session', 'swap_to_rest', 'freeze_week', 'record_symptom')
  ),
  params JSONB NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'declined', 'reverted')
  ),
  -- Snapshot of pre-apply state used by revert. Null until apply runs.
  reversal JSONB,
  applied_at TIMESTAMPTZ,
  reverted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coach_chat_actions_message_idx
  ON coach_chat_actions(chat_message_id);

CREATE INDEX IF NOT EXISTS coach_chat_actions_user_status_idx
  ON coach_chat_actions(user_id, status);
