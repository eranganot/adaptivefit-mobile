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
import {
  coachChatActions,
  trainingRoadmap,
  userLevelState,
  feedbackSentiment,
  workoutLogs,
  users,
  type CoachChatAction,
} from "@/lib/db/schema";
import type { SessionPlan } from "@/lib/coach";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

type Result =
  | { success: true }
  | { success: false; error: string };

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

type LoadOk = { ok: true; row: CoachChatAction };
type LoadErr = { ok: false; error: string };

async function loadPendingAction(actionId: string, userId: string): Promise<LoadOk | LoadErr> {
  const row = await db.query.coachChatActions.findFirst({
    where: and(eq(coachChatActions.id, actionId), eq(coachChatActions.userId, userId)),
  });
  if (!row) return { ok: false, error: "Action not found" };
  if (row.status !== "pending") return { ok: false, error: `Action already ${row.status}` };
  return { ok: true, row };
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

    const loaded = await loadPendingAction(actionId, userId);
    if (!loaded.ok) return { success: false, error: loaded.error };
    const { row } = loaded;
    const params = row.params as Record<string, unknown>;

    let reversal: Record<string, unknown> | null = null;

    if (row.actionType === "soften_session") {
      const sessionId = String(params.sessionId ?? "");
      const reductionPct = Math.min(50, Math.max(10, Number(params.reductionPct ?? 25)));
      if (!sessionId) return { success: false, error: "Missing sessionId" };

      const target = await db.query.trainingRoadmap.findFirst({
        where: and(eq(trainingRoadmap.id, sessionId), eq(trainingRoadmap.userId, userId)),
      });
      if (!target) return { success: false, error: "Target session not found" };

      const plan = target.sessionPlan as SessionPlan;
      // Snapshot for revert
      reversal = { sessionPlan: target.sessionPlan, source: target.source, status: target.status };

      // Reduce run_block distance/reps and warmup duration by reductionPct.
      const factor = 1 - reductionPct / 100;
      const newPlan: SessionPlan = {
        ...plan,
        title: `${plan.title} (eased)`,
        rationale: row.reason,
        blocks: plan.blocks.map((b) => {
          if (b.kind === "run_block") {
            return {
              ...b,
              reps: Math.max(1, Math.round(b.reps * factor)),
              distanceKm: Math.max(0.4, Math.round(b.distanceKm * factor * 10) / 10),
            };
          }
          if (b.kind === "warmup") {
            return { ...b, durationMin: Math.max(5, Math.round(b.durationMin * factor)) };
          }
          return b;
        }),
      };

      await db
        .update(trainingRoadmap)
        .set({ sessionPlan: newPlan, source: "coach_proposal", status: "modified" })
        .where(eq(trainingRoadmap.id, sessionId));
    } else if (row.actionType === "swap_to_rest") {
      const sessionId = String(params.sessionId ?? "");
      if (!sessionId) return { success: false, error: "Missing sessionId" };

      const target = await db.query.trainingRoadmap.findFirst({
        where: and(eq(trainingRoadmap.id, sessionId), eq(trainingRoadmap.userId, userId)),
      });
      if (!target) return { success: false, error: "Target session not found" };

      reversal = { sessionPlan: target.sessionPlan, source: target.source, status: target.status };

      const restPlan: SessionPlan = {
        title: "Rest day",
        rationale: row.reason,
        blocks: [{ kind: "rest" }],
      };

      await db
        .update(trainingRoadmap)
        .set({ sessionPlan: restPlan, source: "coach_proposal", status: "modified" })
        .where(eq(trainingRoadmap.id, sessionId));
    } else if (row.actionType === "freeze_week") {
      const days = Math.min(14, Math.max(1, Number(params.days ?? 7)));
      const existing = await db.query.userLevelState.findFirst({
        where: eq(userLevelState.userId, userId),
      });
      reversal = existing
        ? {
            freezeActive: existing.freezeActive,
            freezeReason: existing.freezeReason,
            manualOverride: existing.manualOverride,
            manualOverrideUntil: existing.manualOverrideUntil,
          }
        : null;

      const until = new Date();
      until.setDate(until.getDate() + days);

      if (!existing) {
        await db.insert(userLevelState).values({
          userId,
          currentLevel: 1,
          greenSessionCount: 0,
          freezeActive: true,
          freezeReason: row.reason,
          lastEvaluatedAt: new Date(),
          manualOverride: true,
          manualOverrideUntil: until,
        });
      } else {
        await db
          .update(userLevelState)
          .set({
            freezeActive: true,
            freezeReason: row.reason,
            manualOverride: true,
            manualOverrideUntil: until,
            lastEvaluatedAt: new Date(),
          })
          .where(eq(userLevelState.userId, userId));
      }
    } else if (row.actionType === "record_symptom") {
      const symptom = String(params.symptom ?? "");
      const severity = Math.min(10, Math.max(0, Number(params.severity ?? 0)));
      if (!symptom) return { success: false, error: "Missing symptom" };

      // Find the workout this chat thread is about (via the chat message link)
      const msg = await db.query.coachChatMessages.findFirst({
        where: (m, { eq: e }) => e(m.id, row.chatMessageId),
      });
      if (!msg?.workoutLogId) {
        return { success: false, error: "Cannot record symptom — no linked workout" };
      }

      const existing = await db.query.feedbackSentiment.findFirst({
        where: eq(feedbackSentiment.workoutLogId, msg.workoutLogId),
      });
      if (existing) {
        reversal = { symptoms: existing.symptoms, severity: existing.severity };
        const nextSymptoms = Array.from(new Set([...(existing.symptoms ?? []), symptom]));
        await db
          .update(feedbackSentiment)
          .set({ symptoms: nextSymptoms, severity: Math.max(existing.severity, severity) })
          .where(eq(feedbackSentiment.workoutLogId, msg.workoutLogId));
      } else {
        // No prior sentiment row — create one. Need workout type/RPE/etc, but
        // we can synthesize a minimal record. Mark created so revert deletes it.
        const workout = await db.query.workoutLogs.findFirst({
          where: eq(workoutLogs.id, msg.workoutLogId),
        });
        if (!workout) return { success: false, error: "Linked workout not found" };
        reversal = { created: true };
        await db.insert(feedbackSentiment).values({
          workoutLogId: workout.id,
          overallSentiment: severity >= 5 ? "concern" : "neutral",
          symptoms: [symptom],
          severity,
          aiSummaryEn: row.reason,
          aiSummaryHe: null,
          geminiModel: "coach_proposal",
        });
      }
    }

    // Mark approved + record reversal
    await db
      .update(coachChatActions)
      .set({ status: "approved", appliedAt: new Date(), reversal: reversal ?? {} })
      .where(eq(coachChatActions.id, actionId));

    // Regenerate plan so changes propagate. Non-fatal if it errors.
    try {
      await regenerateRoadmapForUser(userId);
    } catch (e) {
      console.error("[applyChatAction] regen non-fatal:", e);
    }

    revalidatePath("/coach");
    revalidatePath("/coach/[workoutLogId]", "page");
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

    const loaded = await loadPendingAction(actionId, userId);
    if (!loaded.ok) return { success: false, error: loaded.error };

    await db
      .update(coachChatActions)
      .set({ status: "declined" })
      .where(eq(coachChatActions.id, actionId));

    revalidatePath("/coach");
    revalidatePath("/coach/[workoutLogId]", "page");
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

    const row = await db.query.coachChatActions.findFirst({
      where: and(eq(coachChatActions.id, actionId), eq(coachChatActions.userId, userId)),
    });
    if (!row) return { success: false, error: "Action not found" };
    if (row.status !== "approved") return { success: false, error: `Cannot revert (status=${row.status})` };
    const reversal = (row.reversal ?? {}) as Record<string, unknown>;
    const params = row.params as Record<string, unknown>;

    if (row.actionType === "soften_session" || row.actionType === "swap_to_rest") {
      const sessionId = String(params.sessionId ?? "");
      const sessionPlan = reversal.sessionPlan;
      const source = (reversal.source as "auto" | "manual" | "coach_proposal" | undefined) ?? "auto";
      const status = (reversal.status as "pending" | "completed" | "skipped" | "modified" | undefined) ?? "pending";
      if (!sessionId || !sessionPlan) return { success: false, error: "Reversal data missing" };
      await db
        .update(trainingRoadmap)
        .set({ sessionPlan, source, status })
        .where(and(eq(trainingRoadmap.id, sessionId), eq(trainingRoadmap.userId, userId)));
    } else if (row.actionType === "freeze_week") {
      if (!reversal || Object.keys(reversal).length === 0) {
        // No prior state — clear freeze and override
        await db
          .update(userLevelState)
          .set({ freezeActive: false, freezeReason: null, manualOverride: false, manualOverrideUntil: null })
          .where(eq(userLevelState.userId, userId));
      } else {
        await db
          .update(userLevelState)
          .set({
            freezeActive: Boolean(reversal.freezeActive),
            freezeReason: (reversal.freezeReason as string | null) ?? null,
            manualOverride: Boolean(reversal.manualOverride),
            manualOverrideUntil: (reversal.manualOverrideUntil as Date | null) ?? null,
          })
          .where(eq(userLevelState.userId, userId));
      }
    } else if (row.actionType === "record_symptom") {
      const msg = await db.query.coachChatMessages.findFirst({
        where: (m, { eq: e }) => e(m.id, row.chatMessageId),
      });
      if (msg?.workoutLogId) {
        if (reversal.created) {
          // We created the sentiment row; delete it on revert.
          await db
            .delete(feedbackSentiment)
            .where(eq(feedbackSentiment.workoutLogId, msg.workoutLogId));
        } else {
          // Restore prior symptoms / severity
          await db
            .update(feedbackSentiment)
            .set({
              symptoms: (reversal.symptoms as string[]) ?? [],
              severity: Number(reversal.severity ?? 0),
            })
            .where(eq(feedbackSentiment.workoutLogId, msg.workoutLogId));
        }
      }
    }

    await db
      .update(coachChatActions)
      .set({ status: "reverted", revertedAt: new Date() })
      .where(eq(coachChatActions.id, actionId));

    try {
      await regenerateRoadmapForUser(userId);
    } catch (e) {
      console.error("[revertChatAction] regen non-fatal:", e);
    }

    revalidatePath("/coach");
    revalidatePath("/coach/[workoutLogId]", "page");
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
  actionType: "soften_session" | "swap_to_rest" | "freeze_week" | "record_symptom";
  params: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "declined" | "reverted";
};

export async function getActionsForThread(workoutLogId: string): Promise<ChatActionView[]> {
  try {
    const auth = await authedUserId();
    if (!auth.ok) return [];
    const { userId } = auth;

    // Two-query approach: first find the chat message ids for this thread,
    // then pull the actions tied to any of them. Avoids a fragile join.
    const threadMessages = await db.query.coachChatMessages.findMany({
      where: (m, { eq: e, and: a }) => a(e(m.userId, userId), e(m.workoutLogId, workoutLogId)),
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
