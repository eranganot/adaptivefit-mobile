/**
 * lib/coach/threads.ts
 *
 * Multi-thread chat coach plumbing — Round 7.
 *
 * One row per chat thread in coach_threads:
 *   - General thread:   workout_log_id IS NULL, title = "General chat"
 *   - Workout debrief:  workout_log_id = the workout being discussed
 *
 * The "Start a new conversation" CTA inserts a fresh general thread on each
 * click so the user always lands on an empty UI. The "Chat about your latest
 * workout" CTA reuses an existing workout-debrief thread for the same
 * workout (one thread per workout) so the user doesn't fragment a single
 * debrief across multiple threads.
 *
 * Not a "use server" file — these helpers are called from BOTH server
 * components (page-level data loads) AND server actions (form submissions),
 * so they must be plain importable functions. Auth-bearing call sites do
 * their own session check before invoking these.
 */

import { db } from "@/lib/db";
import { coachThreads, coachChatMessages, workoutLogs } from "@/lib/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

export type ThreadKind = "general" | "workout";

export type ThreadView = {
  id: string;
  kind: ThreadKind;
  workoutLogId: string | null;
  title: string;
  performedAt: Date | null;   // for workout threads — anchor workout's date
  workoutType: string | null; // for workout threads — anchor workout's type
  createdAt: Date;
  lastMessageAt: Date;
  messageCount: number;
  lastMessage: string | null;
};

/**
 * Create a new general thread (workout_log_id NULL) for the given user.
 * Each call inserts a fresh row — that's the whole point of the multi-thread
 * design. Returns the new thread id.
 *
 * Title is generated as "General chat — <today's date>" so the ChatList
 * row is distinguishable from previous general threads.
 */
export async function createGeneralThread(userId: string): Promise<{ id: string }> {
  const todayLabel = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const [row] = await db
    .insert(coachThreads)
    .values({
      userId,
      workoutLogId: null,
      title: `General chat — ${todayLabel}`,
    })
    .returning({ id: coachThreads.id });
  return { id: row.id };
}

/**
 * Get or create the single workout-debrief thread for a given workout.
 *
 * Workout debriefs are one-per-workout intentionally — the user clicking
 * "Chat about your latest workout" twice in a week should land back in the
 * same conversation rather than fragmenting. The general-thread CTA is the
 * one that always creates a new row.
 *
 * Returns the thread id. Throws if the workout doesn't exist or isn't owned
 * by the caller.
 */
export async function getOrCreateWorkoutThread(
  userId: string,
  workoutLogId: string,
): Promise<{ id: string }> {
  // Ownership check — refuse to create a thread for a workout that's not
  // ours. Prevents a forged URL from auto-creating cross-user threads.
  const workout = await db.query.workoutLogs.findFirst({
    where: and(eq(workoutLogs.id, workoutLogId), eq(workoutLogs.userId, userId)),
    columns: { id: true, performedAt: true, type: true },
  });
  if (!workout) {
    throw new Error("Workout not found or not owned by user");
  }

  const existing = await db.query.coachThreads.findFirst({
    where: and(
      eq(coachThreads.userId, userId),
      eq(coachThreads.workoutLogId, workoutLogId),
    ),
    columns: { id: true },
  });
  if (existing) return { id: existing.id };

  const performedLabel = workout.performedAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const title = `${capitalize(workout.type)} debrief — ${performedLabel}`;
  const [row] = await db
    .insert(coachThreads)
    .values({
      userId,
      workoutLogId,
      title,
    })
    .returning({ id: coachThreads.id });
  return { id: row.id };
}

/**
 * Load a single thread, scoped to the user. Returns null if not found.
 */
export async function getThread(
  userId: string,
  threadId: string,
): Promise<{
  id: string;
  workoutLogId: string | null;
  title: string | null;
  createdAt: Date;
  lastMessageAt: Date;
} | null> {
  const row = await db.query.coachThreads.findFirst({
    where: and(eq(coachThreads.id, threadId), eq(coachThreads.userId, userId)),
    columns: {
      id: true,
      workoutLogId: true,
      title: true,
      createdAt: true,
      lastMessageAt: true,
    },
  });
  return row ?? null;
}

/**
 * Bump the thread's `last_message_at` to NOW. Called by coachChatTurn after
 * each user message so the ChatList ordering reflects activity.
 */
export async function touchThread(threadId: string): Promise<void> {
  await db
    .update(coachThreads)
    .set({ lastMessageAt: new Date() })
    .where(eq(coachThreads.id, threadId));
}

/**
 * List all threads for a user, newest-active-first, with message-count and
 * last-message preview for the ChatList UI. Excludes threads with zero
 * messages (mostly stillborn threads from accidental double-clicks).
 */
export async function listThreads(
  userId: string,
  limit = 100,
): Promise<ThreadView[]> {
  // Pull threads + aggregated message stats in one query. LEFT JOIN so even
  // empty threads (no messages yet) come back — we filter those out in JS
  // below, after deciding whether to show "no messages yet" placeholders.
  const rows = await db
    .select({
      id: coachThreads.id,
      workoutLogId: coachThreads.workoutLogId,
      title: coachThreads.title,
      createdAt: coachThreads.createdAt,
      lastMessageAt: coachThreads.lastMessageAt,
      messageCount: sql<number>`cast(count(${coachChatMessages.id}) as int)`,
      lastMessage: sql<string | null>`(array_agg(${coachChatMessages.content} order by ${coachChatMessages.createdAt} desc) filter (where ${coachChatMessages.id} is not null))[1]`,
    })
    .from(coachThreads)
    .leftJoin(
      coachChatMessages,
      eq(coachChatMessages.threadId, coachThreads.id),
    )
    .where(eq(coachThreads.userId, userId))
    .groupBy(coachThreads.id)
    .orderBy(desc(coachThreads.lastMessageAt))
    .limit(limit);

  // Hydrate workout-anchor metadata for workout threads in a single follow-up
  // query — keeps the main aggregate query simple.
  const workoutIds = rows
    .map((r) => r.workoutLogId)
    .filter((id): id is string => Boolean(id));

  const workoutMap = new Map<string, { performedAt: Date; type: string }>();
  if (workoutIds.length > 0) {
    const workouts = await db
      .select({
        id: workoutLogs.id,
        performedAt: workoutLogs.performedAt,
        type: workoutLogs.type,
      })
      .from(workoutLogs)
      .where(inArray(workoutLogs.id, workoutIds));
    for (const w of workouts) {
      workoutMap.set(w.id, { performedAt: w.performedAt, type: w.type });
    }
  }

  return rows
    .filter((r) => r.messageCount > 0)
    .map((r): ThreadView => {
      const anchor = r.workoutLogId ? workoutMap.get(r.workoutLogId) : undefined;
      return {
        id: r.id,
        kind: r.workoutLogId ? "workout" : "general",
        workoutLogId: r.workoutLogId,
        title:
          r.title?.trim() ||
          (r.workoutLogId ? "Workout debrief" : "General chat"),
        performedAt: anchor?.performedAt ?? null,
        workoutType: anchor?.type ?? null,
        createdAt: r.createdAt,
        lastMessageAt: r.lastMessageAt,
        messageCount: r.messageCount,
        lastMessage: r.lastMessage,
      };
    });
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
