"use server";

/**
 * Coach chat action server actions — Round 6 Deploy 2.
 *
 * The chat coach emits PROPOSALS via Gemini function calls. Those land in
 * coach_chat_actions with status='pending'. The user then explicitly approves,
 * declines, or (after approving) reverts each one.
 *
 * Apply / decline / revert are the ONLY paths that mutate the plan from chat.
 * The coach itself never writes to training_roadmap, userLevelState, or
 * feedback_sentiment — only the user-initiated actions in this file do.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { coachChatActions, users } from "@/lib/db/schema";
import { applyIn, revertIn, type Result } from "@/lib/coach/chatActionTx";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ─── Helpers ───────────────────────────────────────────────────────
// Use { ok: true | false } as a single discriminator so TypeScript narrows
// these helper return types cleanly at call sites.

type AuthOk = { ok: true; userId: string };
type AuthErr = { ok: false; error: string };

async function authedUserId(): Promise<AuthOk | AuthErr> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: "Not authenticated" };
  const u = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
  if (!u) return { ok: false, error: "User not found" };
  return { ok: true, userId: u.id };
}

// ─── Apply (Approve) ───────────────────────────────────────────────

/**
 * Apply a pending coach proposal. Validates ownership, runs the type-specific
 * mutation, captures a reversal payload, marks the action approved, and
 * regenerates the roadmap so the change is visible everywhere.
 */
export async function applyChatAction(actionId: string): Promise<Result> {
  try {
    const auth = await authedUserId();
    if (!auth.ok) return { success: false, error: auth.error };
    const { userId } = auth;

    const outcome = await db.transaction((tx) => applyIn(tx, actionId, userId));
    if (!outcome.success) return outcome;

    // Regenerate plan so changes propagate. Non-fatal if it errors.
    try {
      await regenerateRoadmapForUser(userId);
    } catch (e) {
      console.error("[applyChatAction] regen non-fatal:", e);
    }

    revalidatePath("/coach");
    revalidatePath("/coach/[threadId]", "page");
    revalidatePath("/home");
    revalidatePath("/roadmap");
    return { success: true };
  } catch (e) {
    console.error("[applyChatAction] error:", e);
    return { success: false, error: e instanceof Error ? e.message : "Apply failed" };
  }
}

// ─── Decline ───────────────────────────────────────────────────────

export async function declineChatAction(actionId: string): Promise<Result> {
  try {
    const auth = await authedUserId();
    if (!auth.ok) return { success: false, error: auth.error };
    const { userId } = auth;

    // Only a still-pending action can be declined; the WHERE makes the check
    // and the write one statement, so it cannot race an Approve.
    const declined = await db
      .update(coachChatActions)
      .set({ status: "declined" })
      .where(
        and(
          eq(coachChatActions.id, actionId),
          eq(coachChatActions.userId, userId),
          eq(coachChatActions.status, "pending"),
        ),
      )
      .returning({ id: coachChatActions.id });
    if (declined.length === 0) return { success: false, error: "Action not found or no longer pending" };

    revalidatePath("/coach");
    revalidatePath("/coach/[threadId]", "page");
    return { success: true };
  } catch (e) {
    console.error("[declineChatAction] error:", e);
    return { success: false, error: "Decline failed" };
  }
}

// ─── Revert (Undo) ─────────────────────────────────────────────────

export async function revertChatAction(actionId: string): Promise<Result> {
  try {
    const auth = await authedUserId();
    if (!auth.ok) return { success: false, error: auth.error };
    const { userId } = auth;

    const outcome = await db.transaction((tx) => revertIn(tx, actionId, userId));
    if (!outcome.success) return outcome;

    try {
      await regenerateRoadmapForUser(userId);
    } catch (e) {
      console.error("[revertChatAction] regen non-fatal:", e);
    }

    revalidatePath("/coach");
    revalidatePath("/coach/[threadId]", "page");
    revalidatePath("/home");
    revalidatePath("/roadmap");
    return { success: true };
  } catch (e) {
    console.error("[revertChatAction] error:", e);
    return { success: false, error: "Revert failed" };
  }
}

// ─── List proposals for a chat thread (used by ChatThread render) ──

export type ChatActionView = {
  id: string;
  chatMessageId: string;
  actionType: "soften_session" | "swap_to_rest" | "freeze_week" | "record_symptom" | "add_session" | "replace_session";
  params: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "declined" | "reverted";
};

export async function getActionsForThread(threadId: string): Promise<ChatActionView[]> {
  try {
    const auth = await authedUserId();
    if (!auth.ok) return [];
    const { userId } = auth;

    // Two-query approach: first find the chat message ids for this thread,
    // then pull the actions tied to any of them. Avoids a fragile join.
    const threadMessages = await db.query.coachChatMessages.findMany({
      where: (m, { eq: e, and: a }) =>
        a(e(m.userId, userId), e(m.threadId, threadId)),
      columns: { id: true },
    });
    if (threadMessages.length === 0) return [];

    const messageIds = threadMessages.map((m) => m.id);
    const rows = await db.query.coachChatActions.findMany({
      where: (a, { eq: e, and: an, inArray }) =>
        an(e(a.userId, userId), inArray(a.chatMessageId, messageIds)),
      columns: {
        id: true,
        chatMessageId: true,
        actionType: true,
        params: true,
        reason: true,
        status: true,
      },
      orderBy: (a, { asc }) => [asc(a.createdAt)],
    });

    return rows.map((r) => ({
      id: r.id,
      chatMessageId: r.chatMessageId,
      actionType: r.actionType,
      params: r.params as Record<string, unknown>,
      reason: r.reason,
      status: r.status,
    }));
  } catch (e) {
    console.error("[getActionsForThread] error:", e);
    return [];
  }
}
