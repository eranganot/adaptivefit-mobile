"use server";

/**
 * Thread management server actions — Round 7 follow-up.
 *
 * Backlog item from the multi-thread refactor (0007): per-thread Delete and
 * Rename, invoked from the 3-dot menu on each ChatList row.
 *
 *   deleteThread — DELETE coach_threads row. The FK on coach_chat_messages
 *                  is ON DELETE CASCADE so all messages for that thread go
 *                  away too. coach_chat_actions also cascades via its FK to
 *                  coach_chat_messages.id, so no orphans are left behind.
 *
 *   renameThread — UPDATE coach_threads.title. Trim + length-cap the input
 *                  client-side already, but enforce again here in case a
 *                  forged request bypasses the form.
 *
 * Both actions are ownership-scoped (WHERE user_id = ?) so a forged thread
 * id can't touch someone else's row.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { coachThreads, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

type Result = { success: true } | { success: false; error: string };

/** Max title length we'll accept from rename. Anything longer truncated. */
const MAX_TITLE_LEN = 80;

async function authedUserId(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: "Not authenticated" };
  const u = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
  if (!u) return { ok: false, error: "User not found" };
  return { ok: true, userId: u.id };
}

/**
 * Permanently delete a chat thread and all of its messages + actions.
 *
 * No undo on purpose — the multi-thread design is "treat threads as
 * lightweight chat sessions you can spin up freely", and an undo would
 * either require a soft-delete column on coach_threads (extra schema) or
 * a snapshot table (more complexity). If a user accidentally deletes the
 * wrong thread, they can recreate one easily — but the history is gone.
 *
 * Ownership-scoped: the WHERE clause includes user_id, so a forged
 * threadId belonging to another user is a silent no-op rather than a
 * leak.
 */
export async function deleteThread(threadId: string): Promise<Result> {
  try {
    const a = await authedUserId();
    if (!a.ok) return { success: false, error: a.error };
    const { userId } = a;

    // Defensive validation. Drizzle would also reject a non-UUID via the FK
    // but failing early gives a cleaner error to the client.
    if (!threadId || typeof threadId !== "string") {
      return { success: false, error: "Invalid thread id" };
    }

    const result = await db
      .delete(coachThreads)
      .where(and(eq(coachThreads.id, threadId), eq(coachThreads.userId, userId)))
      .returning({ id: coachThreads.id });

    if (result.length === 0) {
      // Thread didn't exist or didn't belong to this user. Treat as success
      // from the UI's perspective (the row is gone either way) but log for
      // diagnostics.
      console.warn("[deleteThread] no row deleted for", threadId);
    }

    revalidatePath("/coach");
    return { success: true };
  } catch (err) {
    console.error("[deleteThread] error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Delete failed",
    };
  }
}

/**
 * Rename a chat thread. Empty / whitespace-only titles are rejected — if
 * the user wants the default label back they can delete and recreate.
 */
export async function renameThread(
  threadId: string,
  rawTitle: string,
): Promise<Result> {
  try {
    const a = await authedUserId();
    if (!a.ok) return { success: false, error: a.error };
    const { userId } = a;

    if (!threadId || typeof threadId !== "string") {
      return { success: false, error: "Invalid thread id" };
    }

    const title = (rawTitle ?? "").trim().slice(0, MAX_TITLE_LEN);
    if (title.length === 0) {
      return { success: false, error: "Title can't be empty" };
    }

    const result = await db
      .update(coachThreads)
      .set({ title })
      .where(and(eq(coachThreads.id, threadId), eq(coachThreads.userId, userId)))
      .returning({ id: coachThreads.id });

    if (result.length === 0) {
      return { success: false, error: "Conversation not found" };
    }

    revalidatePath("/coach");
    return { success: true };
  } catch (err) {
    console.error("[renameThread] error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Rename failed",
    };
  }
}
