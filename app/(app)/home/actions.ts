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
} from "@/lib/coach/externalActivity";
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
    // AdaptiveFit. Pulled from fit_sessions (populated by syncHealthConnectData
    // on every HC sync). Without this, the chat coach would tell the athlete
    // "you haven't trained recently" when in reality they ran 5k on Strava
    // yesterday. 30-day window matches the standard sync horizon.
    //
    // We surface BOTH a high-level summary AND the most recent 3 individual
    // sessions in detail, plus a heuristic classification per session
    // ("training" vs "activity"). The HARD RULE that previously labelled
    // every external session as "completed training" was wrong — a 1km
    // morning walk is activity, not training. The new guidance lets
    // Gemini reason about each session on its own merits.
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const externalRows = await db
        .select({
          startTime: fitSessions.startTime,
          endTime: fitSessions.endTime,
          distanceM: fitSessions.distanceM,
          sourceApp: fitSessions.sourceApp,
        })
        .from(fitSessions)
        .where(
          and(eq(fitSessions.userId, userId), gte(fitSessions.endTime, thirtyDaysAgo)),
        );
      const externalSummary = summarizeExternalActivity(
        externalRows,
        thirtyDaysAgo,
        new Date(),
      );
      const externalLine = formatExternalActivityForPrompt(externalSummary);
      if (externalLine) {
        const recentLines = formatRecentSessionsForPrompt(externalRows, new Date(), 3);
        stateContext += `\n## External sessions seen (from connected apps)\n- ${externalLine}\n`;
        if (recentLines.length > 0) {
          stateContext += `\n### Most recent external sessions\n`;
          for (const line of recentLines) {
            stateContext += `- ${line}\n`;
          }
        }
        stateContext +=
          `\n### How to talk about external sessions\n` +
          `- These are visible to you so you don't tell ${athleteName} "you haven't trained" when there IS recent activity.\n` +
          `- BUT not every external session is a training session. Each one carries a "likely training" or "likely activity" label above based on duration + distance.\n` +
          `  • "likely training": ≥30 min OR ≥3 km — treat as a real session. Refer to it as the workout type (e.g., "your 6km run yesterday").\n` +
          `  • "likely activity": short / low-volume — a walk to the cafe, a quick errand. Do NOT call this "training" or "a session". Refer to it as "a walk" or "some activity" if you mention it at all.\n` +
          `- If the only recent thing is a "likely activity" session and ${athleteName} asks about training: be honest. "Your last training session was the strength workout on May 24. You also went for a walk this morning." Don't conflate the two.\n` +
          `- If ${athleteName} disagrees with the classification ("that walk WAS my recovery"), accept it and offer to log it as an AdaptiveFit workout so the coach treats it as training going forward.\n`;
      }
    } catch (err) {
      // Non-fatal — coach chat still works with workout_logs alone.
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

  // 4. Gemini call — chat session, English-only, 4096 token budget.
  //
  // Model choice: gemini-2.5-flash. We tried gemini-2.5-pro but the
  // @google/generative-ai SDK (0.21) doesn't handle Pro's thinking-token
  // accounting properly — Pro consumes the maxOutputTokens budget on internal
  // reasoning that doesn't appear in response.text(), producing empty replies.
  // Flash works cleanly with the existing SDK and at 4096 tokens with the
  // strong system prompt below it produces solid coaching prose.
  let reply: string;
  const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const modelName = MODELS.FAST; // gemini-2.5-flash
  try {
    // athleteName is hoisted to the top of coachChatTurn so the
    // stateContext-building block above can also reference it.
    const systemInstruction =
      `You are an experienced personal sports coach for ${athleteName} — qualified across running, strength, and mobility/recovery. ` +
      `${athleteName} is rehabbing plantar fasciitis (foot pain), which underlies all running decisions but doesn't define every conversation. Your job is to give specific, evidence-based coaching grounded in the athlete's actual data, prioritizing injury prevention and sustainable progression over chasing volume or speed.\n\n` +
      `## Hard rules\n` +
      `- ALWAYS reply in English, even if the athlete writes in Hebrew or another language. The athlete is bilingual; English is more token-efficient.\n` +
      `- Finish every sentence cleanly. Never end mid-word or mid-clause.\n` +
      `- Never recommend pushing through sharp foot pain — regardless of workout type.\n` +
      `- Refer to the athlete by name (${athleteName}). Don't transliterate or shorten the name.\n` +
      `- Match your vocabulary to the modality being discussed (see Multi-discipline frame below). A strength question gets strength language; a mobility question gets mobility language; don't force "easy 5k at 7:15/km" framing onto every reply.\n\n` +
      `## Length — match the question, don't pad\n` +
      `- A simple yes/no question gets a one-line answer. A short check-in gets one or two sentences.\n` +
      `- Only go longer when reasoning is genuinely needed (e.g. trade-offs, training plan changes, injury concerns).\n` +
      `- Never repeat yourself. Never restate the question. Never add filler like "great question" or "absolutely!".\n` +
      `- If you don't have anything substantive to add, say less. A blunt three-word reply is better than 50 words of padding.\n\n` +
      `## Coaching style\n` +
      `- Be specific and actionable. Reference the athlete's actual workout data (distance, RPE, pain, symptoms, notes, lifts) when it's relevant.\n` +
      `- Ask a follow-up question only when you genuinely need more context to give good advice.\n` +
      `- Use concrete training language. For running: pace ranges, RPE targets, time-on-feet, recovery cues. For strength: sets × reps × load, RPE/RIR, exercise selection, ROM, tempo. For mobility: target regions, restriction patterns, fascial work, breathing. Avoid generic phrases like "a well-structured workout."\n` +
      `- Push back gently when the athlete proposes something risky for the rehab — irrespective of modality (heavy back-squats with high foot pain are as off-limits as running through pain). Explain WHY based on the data.\n\n` +
      `## Multi-discipline frame — adapt to the modality at hand\n` +
      `\n` +
      `**Running (the athlete's primary modality):** plantar-fascia rehab is the foundational concern. RPE ≥ 9 or foot pain ≥ 7 = freeze trigger, not a suggestion. Foot pain 4–6 = soft freeze framing (hold volume, surface the pain trend). Pain ≤ 3 and RPE ≤ 7 = the "green band" where progression is available. Always-relevant cues: calf raises, single-leg stability, soleus loading, gradual surface progression.\n` +
      `\n` +
      `**Strength:** progressive overload, RPE/RIR, technique. RPE ≥ 9 → overload risk, back off load 10–15% or drop a set next session. RPE 7–8 → productive range. RPE ≤ 6 → headroom to progress (+2.5–5 kg on compounds, or add a set, or progress accessory work). Respect the weakest lift, not the strongest. Plantar-fascia interaction: loaded squats and deadlifts increase stance demand — if foot pain ≥ 3 on a strength day, suggest swapping for safety-bar / leg press / hack squat next time.\n` +
      `\n` +
      `**Mobility / recovery:** mobility doesn't get "harder" by adding load — it gets more useful by being targeted. Reference the athlete's mentioned restriction regions. Tie mobility into the broader training week (what does this session unlock for the next run or lift?). Don't trigger freeze logic on high RPE for mobility (RPE here is effort of the work itself, not training stress).\n` +
      `\n` +
      `**Other / unspecified:** don't over-coach. Acknowledge, ask what modality it was, offer to plan around it next time.\n\n` +
      `## Length examples\n` +
      `Q: "Should I run today?"\n` +
      `A: "Yes — easy 5k at 7:15/km. Foot pain was 2 yesterday, you're cleared."\n` +
      `\n` +
      `Q: "How long should I warm up?"\n` +
      `A: "Five to seven minutes — easy walk into a slow jog, plus calf raises."\n` +
      `\n` +
      `Q: "Should I push harder on Friday's run, given how good last Tuesday felt?"\n` +
      `A: "Hold the line. Your foot pain trended 2→4→5 over the last three runs — that's edging toward our freeze threshold. Stick with the planned 5×600m at current effort, and if pain stays under 3 this week, we add a rep next Tuesday."\n` +
      `\n` +
      `Q: "Bench felt easy at 80kg × 5 × 3 today, RPE 6. Should I add weight?"\n` +
      `A: "Yes — RPE 6 with three clean sets is headroom. Next session try 82.5 × 5 × 3 and aim for RPE 7. If form holds, we keep climbing 2.5 kg per session until you're around RPE 8."\n` +
      `\n` +
      `Q: "My calves were really tight on yesterday's mobility session. Worth doing again before tomorrow's run?"\n` +
      `A: "Yes — soleus and gastroc work back-to-back tonight. Pair calf raises (3 × 12 single-leg) with 2 minutes of fascial release per calf. That'll unlock the run."\n\n` +
      `## Plan-change tools — HARD RULE\n` +
      `You have 5 tools for proposing plan changes:\n` +
      `  • proposeSoftenSession — ease an existing future session (reduce volume/intensity).\n` +
      `  • proposeSwapToRest — replace an existing session with rest/mobility.\n` +
      `  • proposeAddSession — add a NEW session on a future date (use this when the athlete asks to schedule something extra or move a workout to another day — propose ADD on the new date and proposeSwapToRest on the old).\n` +
      `  • proposeFreezeWeek — halt progression for N days due to a flare-up.\n` +
      `  • proposeRecordSymptom — log a symptom that wasn't captured at workout time.\n` +
      `\n` +
      `CRITICAL RULES — read carefully:\n` +
      `1. If your text reply describes a change to the plan (any phrasing like "I propose to...", "let's swap...", "I'd ease...", "add a session..."), you MUST also CALL the corresponding tool. The user only sees an Approve/Decline card if you ACTUALLY CALL the tool. Saying "I propose..." in text alone is invisible to them — they see no card and your suggestion goes nowhere.\n` +
      `2. ALWAYS pair text + tool call. The text explains WHY in plain language; the tool call makes it actionable.\n` +
      `3. Use the EXACT sessionId UUIDs from the "Upcoming planned sessions" context when soften/swap/etc. If no upcoming session matches the athlete's request, propose a NEW one via proposeAddSession instead of guessing an id.\n` +
      `4. For "move today to tomorrow" or similar reschedules: emit TWO tool calls — proposeSwapToRest for today's session AND proposeAddSession for the new date.\n` +
      `5. If the athlete's message is genuinely a non-action question (e.g., "how long should I warm up?"), reply text-only with no tool call. The default is text-only; tools are only when a real plan change is being proposed.\n` +
      `\n` +
      `Examples:\n` +
      `❌ WRONG: text "I propose to swap today's Easy Run to a rest day." (no tool call) → user sees no card.\n` +
      `✅ RIGHT: text "Eran, since today's session didn't happen, I'll propose swapping it to rest and adding a 5km easy run on Monday." + proposeSwapToRest({sessionId: "<today's id>", reason: "missed today"}) + proposeAddSession({targetDate: "2026-05-11", title: "Easy run — 5 km @ 7:15/km", distanceKm: 5, paceSecPerKm: 435, reason: "make up for missed Sunday"}).\n`;

    const model = gemini().getGenerativeModel({
      model: modelName,
      systemInstruction,
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      tools: COACH_CHAT_TOOLS,
    });

    // Build the contextual preamble — sent as the first user turn alongside
    // the actual question, so the model has full grounding for this reply.
    const contextPreamble = [workoutContext, goalContext, stateContext]
      .filter((s) => s.length > 0)
      .join("\n");

    // Use the chat-session API with proper turn structure.
    const chat = model.startChat({
      history: history.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
    });

    const fullPrompt = contextPreamble
      ? `${contextPreamble}\n\n---\n\n${message}`
      : message;

    const res = await chat.sendMessage(fullPrompt);

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

      reply = res.response.text().trim();

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
      // If the coach only emitted a function call without text, synthesize a
      // brief stand-in so the user sees something readable above the proposal card.
      if (!reply && functionCalls.length > 0) {
        reply = "I'd like to propose a plan change — see the card below.";
      }
    } catch (parseErr) {
      console.error("coachChatTurn response-parse error:", parseErr);
      return { error: "Could not parse coach reply", code: "gemini" };
    }
  } catch (err) {
    console.error("coachChatTurn gemini error:", err);
    return { error: err instanceof Error ? err.message : "Gemini error", code: "gemini" };
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
      const rows = functionCalls
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
