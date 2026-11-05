/**
 * The transactional core of the coach chat actions (AF-B4, AF-B5).
 *
 * Kept out of app/(app)/coach/actions.ts on purpose: everything exported from a
 * "use server" file is a server action a client can call, and these take a
 * userId argument. The server actions there authenticate, then call these
 * inside db.transaction(). Also what makes them testable against Postgres.
 */
import type { Tx } from "@/lib/db";
import {
  coachChatActions,
  trainingRoadmap,
  userLevelState,
  feedbackSentiment,
  workoutLogs,
  type CoachChatAction,
} from "@/lib/db/schema";
import type { SessionPlan } from "@/lib/coach";
import { startOfWeekSunday } from "@/lib/dates/week";
import { eq, and } from "drizzle-orm";

export type Result =
  | { success: true }
  | { success: false; error: string };

type LoadOk = { ok: true; row: CoachChatAction };
type LoadErr = { ok: false; error: string };

/**
 * Load an action for its owner, locking the row (SELECT ... FOR UPDATE) when
 * called inside a transaction. AF-B4: a double-tap on Approve ran the whole
 * check-then-mutate twice; with the lock the second call waits, then sees
 * status='approved' and stops.
 */
export async function loadActionLocked(tx: Tx, actionId: string, userId: string): Promise<CoachChatAction | undefined> {
  const rows = await tx
    .select()
    .from(coachChatActions)
    .where(and(eq(coachChatActions.id, actionId), eq(coachChatActions.userId, userId)))
    .for("update");
  return rows[0];
}

async function loadPendingAction(tx: Tx, actionId: string, userId: string): Promise<LoadOk | LoadErr> {
  const row = await loadActionLocked(tx, actionId, userId);
  if (!row) return { ok: false, error: "Action not found" };
  if (row.status !== "pending") return { ok: false, error: `Action already ${row.status}` };
  return { ok: true, row };
}

/** AF-B5: only a session still ahead of the user may be rewritten by the coach. */
const EDITABLE_SESSION = new Set(["pending", "modified"]);


/**
 * The check and every mutation of one Approve, in one transaction with the
 * action row locked (AF-B4). Returns before writing anything on a bad request.
 */
export async function applyIn(db: Tx, actionId: string, userId: string): Promise<Result> {
    const loaded = await loadPendingAction(db, actionId, userId);
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
      if (!EDITABLE_SESSION.has(target.status)) return { success: false, error: `That session is already ${target.status}` };

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
      if (!EDITABLE_SESSION.has(target.status)) return { success: false, error: `That session is already ${target.status}` };

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
    } else if (row.actionType === "replace_session") {
      // Replace the workout on an existing planned day. Keeps the row (and so
      // its date), swaps the run blocks, keeps warm-up / mobility / strength.
      const sessionId = String(params.sessionId ?? "");
      if (!sessionId) return { success: false, error: "Missing sessionId" };
      const target = await db.query.trainingRoadmap.findFirst({
        where: and(eq(trainingRoadmap.id, sessionId), eq(trainingRoadmap.userId, userId)),
      });
      if (!target) return { success: false, error: "Target session not found" };
      if (!EDITABLE_SESSION.has(target.status)) return { success: false, error: `That session is already ${target.status}` };
      reversal = { sessionPlan: target.sessionPlan, source: target.source, status: target.status };

      const oldPlan = target.sessionPlan as SessionPlan;
      const distanceKm = Math.min(42.2, Math.max(0.1, Number(params.distanceKm ?? 5)));
      const paceSecPerKm = Math.min(900, Math.max(180, Math.round(Number(params.paceSecPerKm ?? 435))));
      const reps = Math.min(30, Math.max(1, Math.round(Number(params.reps ?? 1))));
      const recoverySec = reps > 1 ? Math.min(600, Math.max(0, Math.round(Number(params.recoverySec ?? 90)))) : 0;
      const kept = (oldPlan.blocks ?? []).filter((b) => b.kind !== "run_block" && b.kind !== "rest");
      const newPlan: SessionPlan = {
        ...oldPlan,
        title: String(params.title ?? oldPlan.title),
        rationale: row.reason,
        blocks: [
          ...kept.filter((b) => b.kind === "warmup"),
          { kind: "run_block", distanceKm, paceSecPerKm, reps, recoverySec },
          ...kept.filter((b) => b.kind !== "warmup"),
        ],
      };
      await db
        .update(trainingRoadmap)
        .set({ sessionPlan: newPlan, source: "coach_proposal", status: "pending" })
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
    } else if (row.actionType === "add_session") {
      // Compute weekIndex / dayIndex relative to this Sunday (week anchor).
      const targetDate = String(params.targetDate ?? "");
      const title = String(params.title ?? "Custom session");
      const distanceKm = Number(params.distanceKm ?? 5);
      const paceSecPerKm = Number(params.paceSecPerKm ?? 435);
      if (!targetDate) return { success: false, error: "Missing targetDate" };

      const today = new Date();
      const startOfWeek = startOfWeekSunday(today);

      const targetDateObj = new Date(targetDate);
      targetDateObj.setHours(0, 0, 0, 0);
      const todayMidnight = new Date(today);
      todayMidnight.setHours(0, 0, 0, 0);
      if (targetDateObj < todayMidnight) {
        return { success: false, error: "Cannot schedule in the past." };
      }

      const daysDiff = Math.round(
        (targetDateObj.getTime() - startOfWeek.getTime()) / (1000 * 60 * 60 * 24),
      );
      const weekIndex = Math.floor(daysDiff / 7);
      const dayIndex = daysDiff % 7;

      const plan: SessionPlan = {
        title,
        rationale: row.reason,
        blocks: [
          { kind: "run_block", distanceKm, paceSecPerKm, reps: 1, recoverySec: 0 },
        ],
      };

      const [created] = await db
        .insert(trainingRoadmap)
        .values({
          userId,
          goalId: null,
          weekIndex,
          dayIndex,
          sessionPlan: plan,
          status: "pending" as const,
          source: "coach_proposal" as const,
        })
        .returning({ id: trainingRoadmap.id });

      // Reversal payload = the row we just created. Revert deletes it.
      reversal = { createdSessionId: created.id };
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
    return { success: true };
}


/** Revert, with the action row locked so two Undo taps cannot both restore (AF-B4). */
export async function revertIn(db: Tx, actionId: string, userId: string): Promise<Result> {
    const row = await loadActionLocked(db, actionId, userId);
    if (!row) return { success: false, error: "Action not found" };
    if (row.status !== "approved") return { success: false, error: `Cannot revert (status=${row.status})` };
    const reversal = (row.reversal ?? {}) as Record<string, unknown>;
    const params = row.params as Record<string, unknown>;

    if (row.actionType === "soften_session" || row.actionType === "swap_to_rest" || row.actionType === "replace_session") {
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
    } else if (row.actionType === "add_session") {
      // We created a new training_roadmap row; delete it on revert.
      const createdId = reversal.createdSessionId as string | undefined;
      if (createdId) {
        await db
          .delete(trainingRoadmap)
          .where(and(eq(trainingRoadmap.id, createdId), eq(trainingRoadmap.userId, userId)));
      }
    }

    await db
      .update(coachChatActions)
      .set({ status: "reverted", revertedAt: new Date() })
      .where(eq(coachChatActions.id, actionId));
    return { success: true };
}

