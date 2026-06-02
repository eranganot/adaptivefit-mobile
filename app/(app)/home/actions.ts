"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workoutLogs,
  workoutPhotos,
  coachChatMessages,
  coachChatActions,
  runSessions,
  users,
  userLevelState,
  feedbackSentiment,
  goals,
  strengthLogs,
  fitSessions,
} from "@/lib/db/schema";
import {
  summarizeExternalActivity,
  formatExternalActivityForPrompt,
  formatRecentSessionsForPrompt,
  dedupeOverlappingSessions,
  classifySessionSmart,
} from "@/lib/coach/externalActivity";
import { withGeminiRetry, describeGeminiError } from "@/lib/gemini/retry";
import { summarizeCoachContext } from "@/lib/gemini/summarizeContext";
import { COACH_CHAT_TOOLS, functionNameToActionType } from "@/lib/coach/chatTools";
import { eq, desc, and, inArray, sql, gte } from "drizzle-orm";
import type { GoalCategory } from "@/lib/coach";
import { extractFeedback } from "@/lib/gemini/extractFeedback";
import { summarizePostWorkout } from "@/lib/gemini/summarizePostWorkout";
import { evaluateCoach } from "@/lib/coach";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";
import { revalidatePath } from "next/cache";
import { gemini, MODELS } from "@/lib/gemini/client";

export type LogResult =
  | { success: true; workoutLogId: string; summary: string; adjustments: string[] }
  | { success: false; error: string };

/** Mirror of workout_logs.type enum. Kept in sync manually with schema.ts —
 *  Drizzle doesn't yet derive enum constants we can import. */
const WORKOUT_TYPES = ["run", "strength", "mobility", "other"] as const;
type WorkoutType = (typeof WORKOUT_TYPES)[number];

/** Server-side shape of a single strength_logs insert. The client converts
 *  its string-typed draft entries to this numeric shape before sending. */
export type StrengthEntryInput = {
  /** Exercise name. Required, non-empty after trim. */
  exercise: string;
  /** Weight in kilograms. > 0. */
  weightKg: number;
  /** Reps per set. >= 1. */
  reps: number;
  /** Number of sets at this weight × reps. >= 1. */
  sets: number;
};

export async function logManualWorkout(input: {
  rpe: number;
  footPain: number; // 0 = no pain, 6 = reported pain
  notes: string;
  photo: File | null;
  /** Phase 8b.2: explicit type. Defaults to "run" for back-compat with any
   *  caller that hasn't migrated to the typed signature yet. */
  type?: WorkoutType;
  /** Phase 8b.2: manual distance (km) for non-GPS run logging. Ignored
   *  for non-run types. If a runSessionId is also supplied, the
   *  run_sessions row wins (authoritative GPS distance). */
  distanceKm?: number;
  /** Phase 8b.2: manual duration (sec) — same semantics as distanceKm. */
  durationSec?: number;
  /** Phase 8b.3: strength sheet entries. Only meaningful when type === "strength".
   *  When present, the parent workout_log + all strength_logs rows are
   *  inserted in a single transaction — a failure to insert any strength row
   *  rolls back the parent so the user doesn't end up with an empty
   *  strength workout in their history. Ignored for non-strength types. */
  strengthEntries?: StrengthEntryInput[];
  runSessionId?: string; // link to GPS run session if coming from active-run flow
}): Promise<LogResult> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    const rpe = Math.min(10, Math.max(1, Math.round(input.rpe)));
    const footPain = input.footPain;
    const notes = input.notes.trim();

    // Defensive: reject unknown types (a bad client could otherwise insert
    // a row that violates the CHECK constraint and 500s on the DB layer).
    const type: WorkoutType =
      input.type && WORKOUT_TYPES.includes(input.type) ? input.type : "run";

    // Resolve distance + duration. Priority order:
    //   1. Linked run_session (GPS authoritative)
    //   2. Caller-supplied manual values (quick-log fields)
    //   3. Null (no metrics — typical for strength/mobility/other)
    //
    // The `paceSecPerKm` and `rtl` columns are GENERATED on distance_km +
    // duration_sec, so writing those two values cascades automatically. RTL
    // is also gated on type='run' inside the generated expression, so
    // non-run rows with distance entries (shouldn't happen via this UI but
    // defensive against future callers) won't pollute analytics totals.
    let resolvedDistanceKm: string | undefined;
    let resolvedDurationSec: number | undefined;

    if (input.runSessionId) {
      try {
        const rs = await db.query.runSessions.findFirst({
          where: eq(runSessions.id, input.runSessionId),
          columns: { distanceKm: true, durationSec: true },
        });
        if (rs) {
          // Only carry values that look real — avoids stamping zeros on a row
          // that was started but never moved (which would make RTL=0 noise in
          // the weekly distance chart).
          const dk = Number(rs.distanceKm);
          if (Number.isFinite(dk) && dk > 0) resolvedDistanceKm = rs.distanceKm;
          if (rs.durationSec > 0) resolvedDurationSec = rs.durationSec;
        }
      } catch (e) {
        console.error("run_session lookup non-fatal:", e);
      }
    }

    // Manual quick-log values — only honoured for runs, and only when GPS
    // didn't already supply them. The numeric column is `numeric(6, 2)` so
    // we cap to 2 decimal places to stay within precision.
    if (
      type === "run" &&
      resolvedDistanceKm === undefined &&
      typeof input.distanceKm === "number" &&
      Number.isFinite(input.distanceKm) &&
      input.distanceKm > 0
    ) {
      resolvedDistanceKm = input.distanceKm.toFixed(2);
    }
    if (
      type === "run" &&
      resolvedDurationSec === undefined &&
      typeof input.durationSec === "number" &&
      Number.isFinite(input.durationSec) &&
      input.durationSec > 0
    ) {
      resolvedDurationSec = Math.round(input.durationSec);
    }

    // ── Strength entries (Phase 8b.3) ────────────────────────────
    // Sanitize + validate every entry up-front. Any invalid row aborts the
    // whole insert (no partial strength workouts). Coerce string-typed
    // numbers defensively in case a future caller forgets to.
    const cleanStrengthEntries: StrengthEntryInput[] = [];
    if (type === "strength" && Array.isArray(input.strengthEntries)) {
      for (const raw of input.strengthEntries) {
        const exercise = (raw?.exercise ?? "").trim();
        const weightKg = Number(raw?.weightKg);
        const reps = Number(raw?.reps);
        const sets = Number(raw?.sets);
        // Skip fully-empty rows silently (the UI seeds one blank row by default).
        const isAllEmpty =
          exercise === "" &&
          (!Number.isFinite(weightKg) || weightKg === 0) &&
          (!Number.isFinite(reps) || reps === 0);
        if (isAllEmpty) continue;
        // Anything partially filled but invalid is a user error — reject the
        // entire submission so they can fix it before we persist a half-row.
        if (
          exercise === "" ||
          !Number.isFinite(weightKg) || weightKg <= 0 ||
          !Number.isFinite(reps) || reps < 1 ||
          !Number.isFinite(sets) || sets < 1
        ) {
          return {
            success: false,
            error:
              "Each strength entry needs a name, positive weight, reps ≥ 1, and sets ≥ 1.",
          };
        }
        cleanStrengthEntries.push({
          exercise,
          // numeric(5,2) on weight, integer on reps/sets — round to match
          weightKg: Math.round(weightKg * 100) / 100,
          reps: Math.round(reps),
          sets: Math.round(sets),
        });
      }
    }

    // 1. Insert workout log + (if strength) child strength_logs atomically.
    //    A failure on any strength_logs insert rolls the whole thing back
    //    so the user never sees a strength workout with zero exercises in
    //    their history (would falsely tell the FSM "you did a strength
    //    session" and pollute the Lift Progression chart with a gap).
    const [log] = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(workoutLogs)
        .values({
          userId: user.id,
          performedAt: new Date(),
          type,
          rpe,
          footPain,
          notesRaw: notes || null,
          distanceKm: resolvedDistanceKm,
          durationSec: resolvedDurationSec,
        })
        .returning();

      if (cleanStrengthEntries.length > 0) {
        await tx.insert(strengthLogs).values(
          cleanStrengthEntries.map((e) => ({
            workoutLogId: inserted[0].id,
            userId: user.id,
            exercise: e.exercise,
            weightKg: e.weightKg.toFixed(2),
            reps: e.reps,
            sets: e.sets,
          })),
        );
      }

      return inserted;
    });

    // Link run session → workout log if this came from GPS run
    if (input.runSessionId) {
      try {
        await db
          .update(runSessions)
          .set({ workoutLogId: log.id })
          .where(eq(runSessions.id, input.runSessionId));
      } catch (e) {
        console.error("runSession link non-fatal:", e);
      }
    }

    // 2. Photo (non-fatal)
    if (input.photo && input.photo.size > 0) {
      try {
        const buf = Buffer.from(await input.photo.arrayBuffer());
        await db.insert(workoutPhotos).values({ workoutLogId: log.id, mimeType: input.photo.type, bytes: buf });
      } catch (e) {
        console.error("Photo upload non-fatal:", e);
      }
    }

    // 3. Extract feedback sentiment (non-fatal)
    try {
      // Pass the resolved type (not the hardcoded "run" the original used) so
      // Gemini's symptom/sentiment extraction can adapt prompts for strength
      // vs cardio (e.g. "tweaked my shoulder" matters for strength, "calf
      // tightness" matters for runs). extractFeedback's existing prompt
      // already branches on `type`; this just stops feeding it a lie.
      // Also forward distance/duration when present — extractFeedback uses
      // them as additional grounding context in its prompt.
      const fb = await extractFeedback({
        notes,
        type,
        rpe,
        footPain,
        distanceKm: resolvedDistanceKm ? Number(resolvedDistanceKm) : null,
        durationSec: resolvedDurationSec ?? null,
      });
      await db.insert(feedbackSentiment).values({
        workoutLogId: log.id,
        overallSentiment: fb.data.overall_sentiment,
        symptoms: fb.data.symptoms,
        severity: fb.data.severity,
        aiSummaryEn: fb.data.ai_summary_en,
        aiSummaryHe: fb.data.ai_summary_he,
        geminiModel: fb.modelUsed,
      });

      // Phase 8b.4 — chat-extracted distance / duration back-fill.
      //
      // Only for runs, and only when the user left the field blank at insert
      // time (`resolvedDistanceKm === undefined` / `resolvedDurationSec ===
      // undefined`). If they typed a value or it came from a linked GPS run,
      // their value is authoritative and we must never overwrite it — that
      // would silently corrupt analytics totals. The prompt is also instructed
      // to return null when a value was already passed as context, providing
      // a second layer of defence.
      //
      // The paceSecPerKm + rtl columns are GENERATED ALWAYS on
      // distance_km + duration_sec, so an UPDATE here cascades to them
      // automatically.
      if (type === "run") {
        const xKm = fb.data.extracted_distance_km;
        const xSec = fb.data.extracted_duration_sec;
        const backfill: Partial<{ distanceKm: string; durationSec: number }> = {};
        if (resolvedDistanceKm === undefined && xKm != null && xKm > 0) {
          backfill.distanceKm = xKm.toFixed(2);
        }
        if (resolvedDurationSec === undefined && xSec != null && xSec > 0) {
          backfill.durationSec = Math.round(xSec);
        }
        if (Object.keys(backfill).length > 0) {
          try {
            await db
              .update(workoutLogs)
              .set(backfill)
              .where(eq(workoutLogs.id, log.id));
            console.info("[logManualWorkout] back-filled from chat extraction:", {
              workoutLogId: log.id,
              backfill,
            });
          } catch (e) {
            console.error("chat back-fill non-fatal:", e);
          }
        }
      }
    } catch (e) {
      console.error("extractFeedback non-fatal:", e);
    }

    // 4. Load coach state + recent logs + active goal for FSM
    const [stateRow, recentRaw, activeGoal] = await Promise.all([
      db.query.userLevelState.findFirst({ where: eq(userLevelState.userId, user.id) }),
      db.select().from(workoutLogs).where(eq(workoutLogs.userId, user.id)).orderBy(desc(workoutLogs.performedAt)).limit(14),
      db.query.goals.findFirst({ where: and(eq(goals.userId, user.id), eq(goals.status, "active")) }),
    ]);

    const sentiments =
      recentRaw.length > 0
        ? await db.select().from(feedbackSentiment).where(inArray(feedbackSentiment.workoutLogId, recentRaw.map((l) => l.id)))
        : [];
    const sentMap = new Map(sentiments.map((s) => [s.workoutLogId, s]));
    const logsWithSentiment = recentRaw.map((l) => ({ ...l, sentiment: sentMap.get(l.id) ?? null }));

    const goalCategory: GoalCategory = (activeGoal?.category ?? "running") as GoalCategory;

    // Also pull external sessions for FSM visibility — same 30d window the
    // chat coach uses. evaluateCoach doesn't currently change plan outcomes
    // based on this (external sessions lack RPE/pain), but it surfaces a
    // `rules_applied` entry that lets us audit whether the FSM had context.
    // Non-fatal if the query fails; FSM still runs with workout_logs alone.
    let externalActivity = undefined;
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const externalRows = await db
        .select({
          startTime: fitSessions.startTime,
          endTime: fitSessions.endTime,
          distanceM: fitSessions.distanceM,
          sourceApp: fitSessions.sourceApp,
          userClassification: fitSessions.userClassification,
        })
        .from(fitSessions)
        .where(
          and(eq(fitSessions.userId, user.id), gte(fitSessions.endTime, thirtyDaysAgo)),
        );
      externalActivity = summarizeExternalActivity(externalRows, thirtyDaysAgo, new Date());
    } catch (err) {
      console.warn("[logManualWorkout] external activity summary failed:", err);
    }

    const coachResult = evaluateCoach({
      recentLogs: logsWithSentiment,
      state: stateRow ?? { currentLevel: 1, greenSessionCount: 0, freezeActive: false, freezeReason: null, manualOverride: false, manualOverrideUntil: null },
      today: new Date(),
      goalCategory,
      externalActivity,
    });

    const { currentLevel, greenSessionCount, freezeActive, freezeReason } = coachResult.newState;
    await db
      .insert(userLevelState)
      .values({ userId: user.id, currentLevel, greenSessionCount, freezeActive, freezeReason, lastEvaluatedAt: new Date() })
      .onConflictDoUpdate({
        target: userLevelState.userId,
        set: { currentLevel, greenSessionCount, freezeActive, freezeReason, lastEvaluatedAt: new Date() },
      });

    // Always regenerate the roadmap after a logged workout. The regenerator
    // pulls fresh state + history + active goal, so it naturally produces an
    // updated plan in response to RPE / pain / symptoms / volume changes.
    // Non-fatal: a regen failure must not fail the workout log.
    try {
      await regenerateRoadmapForUser(user.id);
    } catch (e) {
      console.error("regenerateRoadmap non-fatal:", e);
    }

    // 5. Gemini post-workout summary (non-fatal — workout is already saved).
    //    Multi-discipline as of the coach prompt overhaul: all four workout
    //    types now get a proper coached summary (running coach for runs,
    //    strength coach for strength, mobility coach for mobility, light
    //    acknowledgement for other). The system prompt in
    //    lib/gemini/summarizePostWorkout.ts branches on `type`.
    const recentRpe = recentRaw.map((l) => l.rpe).slice(0, 7);
    let summary = "Workout logged.";
    let adjustments = ["Stay consistent with your training schedule.", "Rest when your body needs it."];
    try {
      const sumResult = await summarizePostWorkout({
        type,
        rpe,
        footPain,
        notes,
        currentLevel,
        recentRpe,
        distanceKm: resolvedDistanceKm ? Number(resolvedDistanceKm) : null,
        durationSec: resolvedDurationSec ?? null,
        strengthEntries: cleanStrengthEntries.length > 0 ? cleanStrengthEntries : undefined,
        athleteName: user.displayName ?? undefined,
      });
      summary = sumResult.summary;
      adjustments = sumResult.adjustments;
    } catch (e) {
      console.error("summarizePostWorkout non-fatal:", e);
    }

    revalidatePath("/home");
    revalidatePath("/roadmap");

    return { success: true, workoutLogId: log.id, summary, adjustments };
  } catch (err) {
    console.error("logManualWorkout error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export type CoachChatErrorCode = "auth" | "limit" | "gemini" | "db" | "unknown";

export type CoachChatResult =
  | { reply: string }
  | { error: string; code: CoachChatErrorCode };

// Hard cap to prevent runaway threads. With rolling-window context (we send
// only the last N messages to Gemini), this cap is a safety net rather than
// a typical-conversation limit.
const CHAT_HARD_CAP_MESSAGES = 100; // 50 user/assistant turns

// Number of recent messages we send to Gemini per turn. The full history is
// always persisted; this just bounds the prompt size.
const CHAT_CONTEXT_WINDOW = 20;

export async function coachChatTurn(
  message: string,
  workoutLogId: string,
): Promise<CoachChatResult> {
  // "general" sentinel → null workoutLogId in the DB. The chat works without
  // a specific workout context (no per-workout details in the prompt).
  const isGeneral = workoutLogId === "general";
  const dbWorkoutLogId: string | null = isGeneral ? null : workoutLogId;

  // 1. Auth + user lookup
  let userId: string;
  let displayName: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.email) return { error: "Not authenticated", code: "auth" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { error: "User not found", code: "auth" };
    userId = user.id;
    displayName = user.displayName ?? null;
  } catch (err) {
    console.error("coachChatTurn auth/user error:", err);
    return { error: err instanceof Error ? err.message : "Auth error", code: "auth" };
  }

  // Resolve the athlete's display name once, used in both stateContext (for
  // the external-sessions section below) and the systemInstruction further
  // down. Hoisted here so both scopes can reference it without redefinition.
  const athleteName = displayName?.trim() || "Eran";

  // 2. Hard-cap check (rare safety net, not a typical-conversation limit)
  try {
    const existing = await db.select().from(coachChatMessages).where(
      and(
        eq(coachChatMessages.userId, userId),
        dbWorkoutLogId === null
          ? sql`${coachChatMessages.workoutLogId} IS NULL`
          : eq(coachChatMessages.workoutLogId, dbWorkoutLogId),
      ),
    );
    if (existing.length >= CHAT_HARD_CAP_MESSAGES) {
      return {
        error: `Chat thread reached ${CHAT_HARD_CAP_MESSAGES / 2}-turn safety cap`,
        code: "limit",
      };
    }
  } catch (err) {
    console.error("coachChatTurn cap-check db error:", err);
    return { error: err instanceof Error ? err.message : "Database error", code: "db" };
  }

  // 3. Persist user message + load context (rolling window of last N + workout/goal/state)
  type HistoryTurn = { role: "user" | "model"; text: string };
  let history: HistoryTurn[] = [];
  let workoutContext = "";
  let goalContext = "";
  let stateContext = "";
  try {
    await db.insert(coachChatMessages).values({ userId, workoutLogId: dbWorkoutLogId, role: "user", content: message });

    // Load last N (CHAT_CONTEXT_WINDOW), reverse to oldest-first.
    // The user's just-inserted message is the last entry; we'll strip it before
    // passing as history (since the API treats the latest user message as the
    // turn we're sending).
    const recent = await db
      .select()
      .from(coachChatMessages)
      .where(and(
        eq(coachChatMessages.userId, userId),
        dbWorkoutLogId === null
          ? sql`${coachChatMessages.workoutLogId} IS NULL`
          : eq(coachChatMessages.workoutLogId, dbWorkoutLogId),
      ))
      .orderBy(desc(coachChatMessages.createdAt))
      .limit(CHAT_CONTEXT_WINDOW);

    // recent is newest-first; reverse to oldest-first, then drop the latest user
    // message (we'll send it as the prompt itself).
    const oldestFirst = recent.reverse();
    const withoutLatest = oldestFirst.slice(0, -1);
    history = withoutLatest.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      text: m.content,
    }));

    // Pull the workout this thread is about + its sentiment, so the coach
    // can ground replies in actual data instead of generic platitudes.
    // General threads have no specific workout — skip this lookup.
    const workout = dbWorkoutLogId
      ? await db.query.workoutLogs.findFirst({ where: eq(workoutLogs.id, dbWorkoutLogId) })
      : null;
    if (workout) {
      const sentiment = await db.query.feedbackSentiment.findFirst({
        where: eq(feedbackSentiment.workoutLogId, workout.id),
      });
      const performedAt = new Date(workout.performedAt).toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short",
      });
      const dist = workout.distanceKm ? `${parseFloat(workout.distanceKm)} km` : "no distance";
      const dur = workout.durationSec
        ? `${Math.floor(workout.durationSec / 60)}:${String(workout.durationSec % 60).padStart(2, "0")}`
        : "no duration";
      const pace = workout.paceSecPerKm
        ? `${Math.floor(workout.paceSecPerKm / 60)}:${String(workout.paceSecPerKm % 60).padStart(2, "0")}/km`
        : "n/a";
      const symptoms = sentiment?.symptoms?.length ? sentiment.symptoms.join(", ") : "none reported";
      const aiSummary = sentiment?.aiSummaryEn ?? "no AI summary";
      const notes = workout.notesRaw?.trim() || "no notes";

      workoutContext =
        `## Workout being discussed (${performedAt})\n` +
        `- Type: ${workout.type}\n` +
        `- Distance: ${dist}, Duration: ${dur}, Pace: ${pace}\n` +
        `- RPE (1-10): ${workout.rpe}, Foot pain (0-10): ${workout.footPain}\n` +
        `- Other pain: ${workout.otherPain ?? "none"}\n` +
        `- Athlete's notes: "${notes}"\n` +
        `- Detected symptoms: ${symptoms}\n` +
        `- AI summary: ${aiSummary}\n`;
    }

    // Active goal (single primary)
    const activeGoal = await db.query.goals.findFirst({
      where: and(eq(goals.userId, userId), eq(goals.status, "active")),
      orderBy: (g, { desc: d }) => [d(g.createdAt)],
    });
    if (activeGoal) {
      const targetVal =
        activeGoal.targetUnit === "sec"
          ? `${Math.floor(parseFloat(activeGoal.targetValue) / 60)}:${String(Math.floor(parseFloat(activeGoal.targetValue) % 60)).padStart(2, "0")}`
          : `${parseFloat(activeGoal.targetValue)} ${activeGoal.targetUnit}`;
      goalContext =
        `## Active goal\n` +
        `- Category: ${activeGoal.category}\n` +
        `- Type: ${activeGoal.type}\n` +
        `- Target: ${targetVal} by ${activeGoal.targetDate}\n` +
        (activeGoal.currentValue ? `- Current: ${parseFloat(activeGoal.currentValue)} ${activeGoal.targetUnit}\n` : "") +
        (activeGoal.note ? `- Note: ${activeGoal.note}\n` : "");
    }

    // Coach state
    const stateRow = await db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, userId),
    });
    if (stateRow) {
      stateContext =
        `## Coach state\n` +
        `- Level: ${stateRow.currentLevel}/10\n` +
        `- Freeze active: ${stateRow.freezeActive ? `YES (${stateRow.freezeReason ?? "unspecified"})` : "no"}\n` +
        (stateRow.manualOverride ? `- Manual level override active until ${stateRow.manualOverrideUntil?.toISOString().slice(0, 10)}\n` : "");
    }

    // External sessions context — workouts/walks/rides from Strava / Samsung
    // Health / Google Fit / etc. that landed in HC but weren't logged in
    // AdaptiveFit.
    //
    // Pipeline:
    //   1. Pull all fit_sessions in 30d window.
    //   2. Dedupe overlapping sessions (Samsung Health splits a single walk
    //      when the user pauses ≥30s; Strava + Samsung Health both recording
    //      the same workout). Keep the longest in each cluster.
    //   3. Aggregate summary line covers ALL sessions (so the coach knows
    //      external training is happening).
    //   4. Per-session detail block only includes UNCLASSIFIED sessions —
    //      the chat coach asks the user to label these. Already-classified
    //      sessions don't need to clutter the prompt every turn.
    //
    // This drops prompt token count significantly (a user with 40 sessions,
    // 35 already labelled, was sending 35 redundant lines per turn).
    let pendingAmbiguousLines: string[] = [];
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const externalRowsRaw = await db
        .select({
          id: fitSessions.id,
          startTime: fitSessions.startTime,
          endTime: fitSessions.endTime,
          distanceM: fitSessions.distanceM,
          sourceApp: fitSessions.sourceApp,
          userClassification: fitSessions.userClassification,
        })
        .from(fitSessions)
        .where(
          and(eq(fitSessions.userId, userId), gte(fitSessions.endTime, thirtyDaysAgo)),
        );

      // Step 2 — dedupe.
      const externalRows = dedupeOverlappingSessions(externalRowsRaw);

      // Step 3 — aggregate summary (all sessions).
      const externalSummary = summarizeExternalActivity(
        externalRows,
        thirtyDaysAgo,
        new Date(),
      );
      const externalLine = formatExternalActivityForPrompt(externalSummary);

      // Step 4 — per-session lines ONLY for unclassified ambiguous sessions.
      // Already-classified rows don't need to recur in the prompt.
      const unclassifiedAmbiguous = externalRows.filter((r) => {
        if (r.userClassification !== null) return false;
        const durationSec = Math.max(
          0,
          Math.round((r.endTime.getTime() - r.startTime.getTime()) / 1000),
        );
        const cls = classifySessionSmart({
          durationSec,
          distanceM: r.distanceM,
          sourceApp: r.sourceApp,
        });
        return cls.bucket === "ambiguous";
      });
      pendingAmbiguousLines = formatRecentSessionsForPrompt(
        unclassifiedAmbiguous,
        new Date(),
        3, // cap at 3 — the chat coach asks about one at a time anyway
      );

      if (externalLine) {
        stateContext += `\n## External sessions (last 30d)\n- ${externalLine}\n`;
        if (pendingAmbiguousLines.length > 0) {
          stateContext += `\n### Ambiguous sessions awaiting classification\n`;
          for (const line of pendingAmbiguousLines) {
            stateContext += `- ${line}\n`;
          }
          stateContext +=
            `\nWhen the athlete has any unaddressed AMBIGUOUS session above, ask about the most recent one at the start of your reply. On the athlete's answer, call classifySession({sessionId, classification}) — immediate, no card. Use the [id=<uuid>] verbatim; do not invent IDs.\n`;
        }
      }
    } catch (err) {
      console.warn("[coachChatTurn] external activity summary failed:", err);
    }

    // Upcoming pending sessions — needed so the model can pass real sessionId
    // UUIDs to proposeSoftenSession / proposeSwapToRest tool calls. We also
    // include the calendar date computed in Asia/Jerusalem so the model can
    // reason about "today", "tomorrow" without hallucinating.
    const tz = "Asia/Jerusalem";

    // Today's calendar date in TZ — used to derive each session's actual date.
    const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const todayJsDow = nowInTz.getDay(); // 0=Sun..6=Sat
    const startOfWeekTz = new Date(nowInTz);
    startOfWeekTz.setDate(nowInTz.getDate() - (todayJsDow === 0 ? 6 : todayJsDow - 1));
    startOfWeekTz.setHours(0, 0, 0, 0);

    const upcomingRows = await db.execute(sql`
      SELECT id, week_index, day_index, session_plan->>'title' AS title
      FROM training_roadmap
      WHERE user_id = ${userId} AND status = 'pending'
      ORDER BY week_index, day_index
      LIMIT 6
    `);
    const upcomingList = (upcomingRows.rows as Array<{ id: string; week_index: number; day_index: number; title: string | null }>);
    if (upcomingList.length > 0) {
      stateContext +=
        `\n## Upcoming planned sessions (use these UUIDs in tool calls)\n` +
        upcomingList
          .map((r) => {
            // Derive calendar date from week_index/day_index relative to this Monday.
            const d = new Date(startOfWeekTz);
            d.setDate(startOfWeekTz.getDate() + r.week_index * 7 + r.day_index);
            const dateStr = d.toISOString().slice(0, 10);
            const dayName = d.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
            return `- id=${r.id} · date=${dateStr} (${dayName}) · ${r.title ?? "(untitled)"}`;
          })
          .join("\n") +
        "\n";
    }

    // CRITICAL: pass current date/time so the model doesn't hallucinate dates.
    // Server-side, so this is authoritative — overrides any wrong assumptions
    // the model might make from training data.
    const nowFormatted = new Date().toLocaleString("en-GB", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const todayIso = new Date()
      .toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .slice(0, 10);
    stateContext =
      `## Current date and time (Asia/Jerusalem)\n` +
      `- Now: ${nowFormatted}\n` +
      `- Today's date (ISO): ${todayIso}\n` +
      `- Use these values when reasoning about "today", "tomorrow", etc. Do NOT guess the date from training data.\n\n` +
      stateContext;
  } catch (err) {
    console.error("coachChatTurn persist/context db error:", err);
    return { error: err instanceof Error ? err.message : "Database error", code: "db" };
  }

  // 4. Gemini call — chat session.
  //
  // Model: gemini-2.5-pro (was Flash). Pro reasons better across the
  // multi-turn coach use case but is slower per token AND its "thinking"
  // tokens count against maxOutputTokens. We bump the output budget to
  // 16k to give thinking + actual response both room. The earlier Flash
  // setup with 4k worked only because Flash doesn't do thinking-tokens.
  //
  // Pipeline this turn:
  //   (a) Summarizer pre-step (Gemini Flash) → ~10-bullet compressed
  //       context. Replaces the verbose workout/state/external blocks.
  //   (b) Main Pro call with retry-with-backoff for transient errors.
  //
  // The trade is +200ms latency from the summarizer for -25k tokens off
  // the main prompt. Net: faster end-to-end on Pro, cheaper per turn, and
  // sharper responses (less noise for the model to sift).
  let reply: string;
  const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const modelName = MODELS.DEEP; // gemini-2.5-pro
  let errorReason: ReturnType<typeof describeGeminiError> | null = null;
  try {
    // ── (a) Context summarizer pre-step ───────────────────────────
    // Pull what the summarizer needs from the data we already loaded
    // earlier in this function. Non-fatal — falls back to a compact
    // deterministic summary on its own.
    let contextSummary = "";
    try {
      // Hydrate recent logs with sentiment for the summarizer.
      const recentForSummary = [];
      {
        const recentRaw = await db
          .select()
          .from(workoutLogs)
          .where(eq(workoutLogs.userId, userId))
          .orderBy(desc(workoutLogs.performedAt))
          .limit(10);
        if (recentRaw.length > 0) {
          const sentiments = await db
            .select()
            .from(feedbackSentiment)
            .where(inArray(feedbackSentiment.workoutLogId, recentRaw.map((l) => l.id)));
          const sentMap = new Map(sentiments.map((s) => [s.workoutLogId, s]));
          for (const l of recentRaw) {
            recentForSummary.push({ ...l, sentiment: sentMap.get(l.id) ?? null });
          }
        }
      }

      const stateRow = await db.query.userLevelState.findFirst({
        where: eq(userLevelState.userId, userId),
      });
      const activeGoal = await db.query.goals.findFirst({
        where: and(eq(goals.userId, userId), eq(goals.status, "active")),
        orderBy: (g, { desc: d }) => [d(g.createdAt)],
      });

      // Reuse the dedupe + ambiguous-only set we already computed for
      // the prompt context above (via `pendingAmbiguousLines`).
      const summary = await summarizeCoachContext({
        athleteName,
        recentLogs: recentForSummary,
        state: stateRow
          ? {
              currentLevel: stateRow.currentLevel,
              freezeActive: stateRow.freezeActive,
              freezeReason: stateRow.freezeReason,
              manualOverride: stateRow.manualOverride,
            }
          : null,
        goal: activeGoal
          ? {
              category: activeGoal.category,
              type: activeGoal.type,
              targetValue: activeGoal.targetValue,
              targetUnit: activeGoal.targetUnit,
              targetDate: activeGoal.targetDate,
              note: activeGoal.note,
            }
          : null,
        externalActivity: null, // already aggregated in stateContext above
        pendingAmbiguousSessions: pendingAmbiguousLines,
      });
      contextSummary = summary.bullets;
      console.info("[coachChatTurn] context summarizer:", JSON.stringify({
        source: summary.source,
        approxTokens: summary.approxTokens,
      }));
    } catch (sumErr) {
      console.warn("[coachChatTurn] summarizer pre-step failed:", sumErr);
    }

    // ── Trimmed system prompt ──────────────────────────────────────
    // Condensed from the v1 multi-discipline prompt (~3k tokens) to
    // ~1.2k tokens. Same coaching philosophy, dropped redundant
    // examples and the verbose multi-discipline frame in favour of
    // a tight rule list.
    const systemInstruction =
      `You are ${athleteName}'s personal sports coach — qualified across running, strength, and mobility. ${athleteName} is rehabbing plantar fasciitis (foot pain). Give specific, evidence-based replies grounded in the athlete's data.\n` +
      `\n` +
      `## Hard rules\n` +
      `- Reply in English (the athlete is bilingual EN/HE; English is token-efficient).\n` +
      `- Refer to the athlete by name (${athleteName}). Don't shorten or transliterate.\n` +
      `- Never recommend pushing through sharp foot pain.\n` +
      `- Match vocabulary to the modality: running = pace/RPE/foot-pain; strength = sets×reps×load/RPE/RIR; mobility = ROM/restriction; other = ask first.\n` +
      `- Finish every sentence cleanly. No filler ("great question", "absolutely").\n` +
      `\n` +
      `## Length policy\n` +
      `Match the question. Yes/no → one line. Short check-in → 1-2 sentences. Only go long when explaining a trade-off, plan change, or injury concern. Never repeat. Three-word blunt reply beats 50 words of padding.\n` +
      `\n` +
      `## Triggers\n` +
      `- Foot pain ≥ 7 OR running RPE ≥ 9 → freeze trigger (not a suggestion).\n` +
      `- Foot pain 4-6 → soft freeze framing (hold volume, surface the pain trend).\n` +
      `- Pain ≤ 3 AND RPE ≤ 7 → "green band" — name the progression opportunity.\n` +
      `- Strength RPE ≥ 9 → overload risk. RPE 7-8 → productive. RPE ≤ 6 → headroom.\n` +
      `- Foot pain ≥ 3 on a strength day → suggest swapping squat/deadlift for safety-bar / leg press next time.\n` +
      `- Mobility: RPE = effort of the work, not training stress. Don't trigger freeze on it.\n` +
      `\n` +
      `## Plan-change tools — HARD RULE\n` +
      `Tools: proposeSoftenSession, proposeSwapToRest, proposeAddSession, proposeFreezeWeek, proposeRecordSymptom, classifySession.\n` +
      `\n` +
      `If your text describes a plan change ("I propose…", "let's swap…", "add a session…"), you MUST also CALL the matching propose* tool. Text alone is invisible — the athlete only sees an Approve/Decline card when the tool fires. Pair text + tool call every time.\n` +
      `\n` +
      `Use the EXACT sessionId UUID from the "Upcoming planned sessions" context. If no match, use proposeAddSession instead of guessing. For "move today to tomorrow": emit TWO calls (proposeSwapToRest for today + proposeAddSession for tomorrow).\n` +
      `\n` +
      `classifySession is different — it applies IMMEDIATELY (no card). Use it when the athlete clearly answers "yes/training" or "no/activity" to an AMBIGUOUS session prompt. Pass the [id=<uuid>] verbatim — don't invent.\n` +
      `\n` +
      `Non-action questions ("how long should I warm up?") → text-only, no tool. Tools fire only when a real plan change is being made.`;

    const model = gemini().getGenerativeModel({
      model: modelName,
      systemInstruction,
      // 16k output budget — Pro spends some tokens on internal "thinking"
      // that don't appear in response.text(); 4k (the old Flash budget)
      // would starve the actual response. 16k still leaves plenty of
      // headroom for chain-of-thought.
      generationConfig: { temperature: 0.4, maxOutputTokens: 16384 },
      tools: COACH_CHAT_TOOLS,
    });

    // Build the contextual preamble. The summarized context (if available)
    // REPLACES the verbose workoutContext + stateContext blocks. goalContext
    // is small enough to keep alongside.
    const contextPreamble = contextSummary
      ? [`## Recent training (bullets)\n${contextSummary}`, stateContext]
          .filter((s) => s.length > 0)
          .join("\n")
      : [workoutContext, goalContext, stateContext]
          .filter((s) => s.length > 0)
          .join("\n");

    const fullPrompt = contextPreamble
      ? `${contextPreamble}\n\n---\n\n${message}`
      : message;

    // Retry-with-backoff wrapper around the actual Gemini call. Retries on
    // transient categories (429, 503, network), throws immediately on
    // terminal categories (bad auth, schema rejection). Each retry
    // re-creates the chat session so a partially-consumed sendMessage
    // state can't poison the next attempt.
    const res = await withGeminiRetry(
      async () => {
        const chat = model.startChat({
          history: history.map((h) => ({
            role: h.role,
            parts: [{ text: h.text }],
          })),
        });
        return chat.sendMessage(fullPrompt);
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (attempt, lastError) => {
          console.warn(
            `[coachChatTurn] Gemini retry ${attempt}/3 after error:`,
            lastError instanceof Error ? lastError.message : String(lastError),
          );
        },
      },
    );

    // Parse the response in its own try/catch so a parsing exception doesn't
    // masquerade as a Gemini API failure. Structured logging gives us a real
    // post-mortem if the shape ever shifts.
    try {
      // Prefer the SDK's canonical helper. It returns an array of function
      // calls or undefined; fall back to manual parts iteration if absent
      // (some SDK builds expose only the raw shape).
      type FunctionCallRaw = { name: string; args: Record<string, unknown> };
      const helperFnCalls = (res.response as unknown as { functionCalls?: () => FunctionCallRaw[] | undefined }).functionCalls?.();
      if (Array.isArray(helperFnCalls) && helperFnCalls.length > 0) {
        for (const fc of helperFnCalls) functionCalls.push(fc);
      } else {
        const candidate = res.response.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        for (const p of parts) {
          const fc = (p as { functionCall?: FunctionCallRaw }).functionCall;
          if (fc) functionCalls.push(fc);
        }
      }

      // Extract text defensively — the @google/generative-ai SDK's .text()
      // can throw "The response contains no text" when the candidate is a
      // pure function-call response (no text parts). Catching here lets us
      // fall through to the function-call-aware fallback below instead of
      // surfacing "Coach service is temporarily unavailable" to the user
      // for a legitimate tool-only reply.
      try {
        reply = res.response.text().trim();
      } catch (textErr) {
        console.warn("coachChatTurn .text() threw (probably function-call-only response):", textErr);
        reply = "";
      }

      // Structured log so Railway tells us exactly what came back if anything
      // looks off in production.
      console.info("coachChatTurn response:", JSON.stringify({
        model: modelName,
        replyLength: reply.length,
        functionCallCount: functionCalls.length,
        functionNames: functionCalls.map((f) => f.name),
        finishReason: res.response.candidates?.[0]?.finishReason ?? null,
      }));

      if (!reply && functionCalls.length === 0) {
        return { error: "Coach returned empty reply", code: "gemini" };
      }
      // If the coach emitted only function calls without text, synthesize a
      // stand-in that ACCURATELY describes what the tool does — splitting
      // by tool family so the user isn't told to look for a card that
      // doesn't exist (classifySession applies immediately, no card).
      if (!reply && functionCalls.length > 0) {
        const hasClassify = functionCalls.some((f) => f.name === "classifySession");
        const hasPropose = functionCalls.some((f) => f.name !== "classifySession");
        if (hasClassify && !hasPropose) {
          // Find the classification value to make the confirmation specific.
          const cls = functionCalls.find((f) => f.name === "classifySession");
          const value = cls?.args?.classification;
          if (value === "training") {
            reply = "Got it — marked as training. The chart and your training totals will reflect that.";
          } else if (value === "activity") {
            reply = "Got it — marked as activity. It won't count toward your training totals.";
          } else {
            reply = "Got it — classification updated.";
          }
        } else if (hasPropose && !hasClassify) {
          reply = "I'd like to propose a plan change — see the card below.";
        } else {
          // Mixed: at least one classify AND at least one propose. Rare.
          reply = "Got it — and I'd like to propose a plan change too. See the card below.";
        }
      }
    } catch (parseErr) {
      console.error("coachChatTurn response-parse error:", parseErr);
      errorReason = describeGeminiError(parseErr);
      return { error: errorReason.userMessage, code: "gemini" };
    }
  } catch (err) {
    console.error("coachChatTurn gemini error:", err);
    errorReason = describeGeminiError(err);
    // Log category so we can see in Railway logs what kind of error
    // bubbled up — rate_limit, context_too_large, network, etc.
    console.error(
      `[coachChatTurn] gemini error category=${errorReason.category}`,
    );
    return { error: errorReason.userMessage, code: "gemini" };
  }

  // 5. Persist assistant reply (model stamp) + any proposed actions linked to it.
  try {
    const [savedAssistant] = await db
      .insert(coachChatMessages)
      .values({
        userId,
        workoutLogId: dbWorkoutLogId,
        role: "assistant",
        content: reply,
        modelUsed: modelName,
      })
      .returning({ id: coachChatMessages.id });

    if (savedAssistant && functionCalls.length > 0) {
      // Split out `classifySession` calls first — those apply IMMEDIATELY
      // (the athlete IS the source of truth on whether a session was
      // training, so no Approve/Decline gate). Everything else (proposeX)
      // goes through the standard pending-action path.
      const classifyCalls = functionCalls.filter((fc) => fc.name === "classifySession");
      const proposeCalls = functionCalls.filter((fc) => fc.name !== "classifySession");

      // Apply classifications inline.
      for (const fc of classifyCalls) {
        const args = fc.args as { sessionId?: unknown; classification?: unknown };
        const sessionId = typeof args.sessionId === "string" ? args.sessionId : null;
        const classification =
          args.classification === "training" || args.classification === "activity"
            ? args.classification
            : null;
        if (!sessionId || !classification) {
          console.warn("[coachChatTurn] classifySession with bad args:", fc.args);
          continue;
        }
        try {
          // Ownership-scoped update — guards against Gemini hallucinating
          // a sessionId that doesn't belong to this user.
          await db
            .update(fitSessions)
            .set({ userClassification: classification })
            .where(and(eq(fitSessions.id, sessionId), eq(fitSessions.userId, userId)));
        } catch (e) {
          console.warn("[coachChatTurn] classifySession update failed:", e);
        }
      }
      if (classifyCalls.length > 0) {
        revalidatePath("/home");
        revalidatePath("/analytics");
      }

      // Map propose* calls to coach_chat_actions rows (pending).
      const rows = proposeCalls
        .map((fc) => {
          const actionType = functionNameToActionType(fc.name);
          if (!actionType) return null;
          // Strip 'reason' out of args — store separately. Whatever remains is params.
          const { reason, ...rest } = fc.args as { reason?: unknown } & Record<string, unknown>;
          return {
            chatMessageId: savedAssistant.id,
            userId,
            actionType,
            params: rest,
            reason: typeof reason === "string" && reason.trim() ? reason.trim() : "(no reason given)",
            status: "pending" as const,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (rows.length > 0) {
        await db.insert(coachChatActions).values(rows);
      }
    }
  } catch (err) {
    console.error("coachChatTurn persist-reply db error (non-fatal):", err);
  }

  return { reply };
}

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

/** Fetch persisted chat messages for a given workout log, oldest-first. */
export async function getChatHistory(
  workoutLogId: string,
  limit = 40,
): Promise<ChatMessage[]> {
  try {
    const session = await auth();
    if (!session?.user?.email) return [];

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return [];

    const isGeneral = workoutLogId === "general";
    const rows = await db
      .select()
      .from(coachChatMessages)
      .where(
        and(
          eq(coachChatMessages.userId, user.id),
          isGeneral
            ? sql`${coachChatMessages.workoutLogId} IS NULL`
            : eq(coachChatMessages.workoutLogId, workoutLogId),
        ),
      )
      .orderBy(coachChatMessages.createdAt)
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    console.error("getChatHistory error:", err);
    return [];
  }
}

export type ChatThread = {
  workoutLogId: string;
  performedAt: Date;
  workoutType: string;
  messageCount: number;
  lastMessage: string;
  lastMessageAt: Date;
};

/** Fetch all workout logs that have at least one coach chat message, newest first. */
export async function getChatThreads(): Promise<ChatThread[]> {
  try {
    const session = await auth();
    if (!session?.user?.email) return [];

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return [];

    // Get workout logs with chat messages via subquery
    const rows = await db
      .select({
        workoutLogId: coachChatMessages.workoutLogId,
        messageCount: sql<number>`cast(count(*) as int)`,
        lastMessage: sql<string>`(array_agg(${coachChatMessages.content} order by ${coachChatMessages.createdAt} desc))[1]`,
        lastMessageAt: sql<Date>`max(${coachChatMessages.createdAt})`,
      })
      .from(coachChatMessages)
      .where(
        and(
          eq(coachChatMessages.userId, user.id),
          sql`${coachChatMessages.workoutLogId} is not null`,
        ),
      )
      .groupBy(coachChatMessages.workoutLogId)
      .orderBy(sql`max(${coachChatMessages.createdAt}) desc`)
      .limit(50);

    // Hydrate workout log metadata for each thread
    const logIds = rows.map((r) => r.workoutLogId).filter(Boolean) as string[];
    if (logIds.length === 0) return [];

    const logs = await db
      .select({ id: workoutLogs.id, performedAt: workoutLogs.performedAt, type: workoutLogs.type })
      .from(workoutLogs)
      .where(inArray(workoutLogs.id, logIds));

    const logMap = new Map(logs.map((l) => [l.id, l]));

    return rows
      .map((r) => {
        const log = logMap.get(r.workoutLogId!);
        if (!log) return null;
        return {
          workoutLogId: r.workoutLogId!,
          performedAt: log.performedAt,
          workoutType: log.type,
          messageCount: r.messageCount,
          lastMessage: r.lastMessage,
          lastMessageAt: r.lastMessageAt,
        };
      })
      .filter(Boolean) as ChatThread[];
  } catch (err) {
    console.error("getChatThreads error:", err);
    return [];
  }
}
