import { sql } from "drizzle-orm";
import { db as rootDb } from "@/lib/db";

/**
 * AF-6 (2026-11-05): a per-user daily budget for coach turns.
 *
 * Each turn is two Gemini calls (summariser + chat model) with up to 16k
 * output tokens, and the only limit was 50 turns per THREAD - with unlimited
 * threads, i.e. no limit. This counts the user's own messages since midnight
 * Asia/Jerusalem across all threads. Default 60 a day (a heavy day of real
 * use is a fraction of that); COACH_DAILY_TURN_LIMIT overrides it, 0 disables.
 */
export const DEFAULT_DAILY_TURNS = 60;
export const MAX_MESSAGE_CHARS = 4000;

export function dailyTurnLimit(env: string | undefined = process.env.COACH_DAILY_TURN_LIMIT): number {
  const n = Number(env);
  return env !== undefined && env.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_TURNS;
}

export async function turnsToday(userId: string, db = rootDb): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n
      FROM coach_chat_messages
     WHERE user_id = ${userId}
       AND role = 'user'
       AND created_at >= ((now() AT TIME ZONE 'Asia/Jerusalem')::date::timestamp AT TIME ZONE 'Asia/Jerusalem')
  `);
  return Number((r.rows[0] as { n: number }).n);
}

/** null when the turn may go ahead, else the message to show. */
export async function dailyCapRefusal(userId: string, db = rootDb): Promise<string | null> {
  const limit = dailyTurnLimit();
  if (limit === 0) return null;
  const used = await turnsToday(userId, db);
  return used >= limit
    ? `You've reached today's coach limit (${limit} messages). It resets at midnight.`
    : null;
}
