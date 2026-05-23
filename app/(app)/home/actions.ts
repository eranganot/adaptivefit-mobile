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
} from "@/lib/db/schema";
import { COACH_CHAT_TOOLS, functionNameToActionType } from "@/lib/coach/chatTools";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
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

export async function logManualWorkout(input: {
  rpe: number;
  footPain: number; // 0 = no pain, 6 = reported pain
  notes: string;
  photo: File | null;
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

    // If this log came from the GPS tracker, pull distance + duration off the
    // run_sessions row so the workout_logs row carries them too. Without this
    // copy, the analytics queries (weekly distance, RPE × pace, daily active
    // minutes) all sum nulls → display 0/empty. The `paceSecPerKm` and `rtl`
    // columns are GENERATED from distance_km + duration_sec, so writing those
    // two fields cascades automatically.
    let runDistanceKm: string | undefined;
    let runDurationSec: number | undefined;
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
          if (Number.isFinite(dk) && dk > 0) runDistanceKm = rs.distanceKm;
          if (rs.durationSec > 0) runDurationSec = rs.durationSec;
        }
      } catch (e) {
        console.error("run_session lookup non-fatal:", e);
      }
    }

    // 1. Insert workout log
    const [log] = await db
      .insert(workoutLogs)
      .values({
        userId: user.id,
        performedAt: new Date(),
        type: "run",
        rpe,
        footPain,
        notesRaw: notes || null,
        distanceKm: runDistanceKm,
        durationSec: runDurationSec,
      })
      .returning();

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
      const fb = await extractFeedback({ notes, type: "run", rpe, footPain });
      await db.insert(feedbackSentiment).values({
        workoutLogId: log.id,
        overallSentiment: fb.data.overall_sentiment,
        symptoms: fb.data.symptoms,
        severity: fb.data.severity,
        aiSummaryEn: fb.data.ai_summary_en,
        aiSummaryHe: fb.data.ai_summary_he,
        geminiModel: fb.modelUsed,
      });
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
    const coachResult = evaluateCoach({
      recentLogs: logsWithSentiment,
      state: stateRow ?? { currentLevel: 1, greenSessionCount: 0, freezeActive: false, freezeReason: null, manualOverride: false, manualOverrideUntil: null },
      today: new Date(),
      goalCategory,
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

    // 5. Gemini post-workout summary (non-fatal — workout is already saved)
    const recentRpe = recentRaw.map((l) => l.rpe).slice(0, 7);
    let summary = "Workout logged! Keep monitoring your effort and pain levels.";
    let adjustments = ["Stay consistent with your training schedule.", "Rest when your body needs it."];
    try {
      const sumResult = await summarizePostWorkout({ rpe, footPain, notes, currentLevel, recentRpe });
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
    const athleteName = displayName?.trim() || "Eran";

    const systemInstruction =
      `You are an experienced personal running coach for ${athleteName}. ` +
      `${athleteName} is a runner currently rehabbing plantar fasciitis (foot pain). Your job is to give specific, ` +
      `data-grounded coaching that prioritizes injury prevention and conservative progression over chasing volume or speed.\n\n` +
      `## Hard rules\n` +
      `- ALWAYS reply in English, even if the athlete writes in Hebrew or another language. The athlete is bilingual; English is more token-efficient.\n` +
      `- Finish every sentence cleanly. Never end mid-word or mid-clause.\n` +
      `- Never recommend pushing through sharp foot pain.\n` +
      `- Refer to the athlete by name (${athleteName}). Don't transliterate or shorten the name.\n\n` +
      `## Length — match the question, don't pad\n` +
      `- A simple yes/no question gets a one-line answer. A short check-in gets one or two sentences.\n` +
      `- Only go longer when reasoning is genuinely needed (e.g. trade-offs, training plan changes, injury concerns).\n` +
      `- Never repeat yourself. Never restate the question. Never add filler like "great question" or "absolutely!".\n` +
      `- If you don't have anything substantive to add, say less. A blunt three-word reply is better than 50 words of padding.\n\n` +
      `## Coaching style\n` +
      `- Be specific and actionable. Reference the athlete's actual workout data (distance, RPE, pain, symptoms, notes) when it's relevant.\n` +
      `- Ask a follow-up question only when you genuinely need more context to give good advice.\n` +
      `- Use concrete training language: pace ranges, RPE targets, time-on-feet, recovery cues. Avoid generic phrases like "a well-structured workout."\n` +
      `- Push back gently when the athlete proposes something risky for the rehab. Explain WHY based on the data.\n\n` +
      `## Length examples\n` +
      `Q: "Should I run today?"\n` +
      `A: "Yes — easy 5k at 7:15/km. Foot pain was 2 yesterday, you're cleared."\n` +
      `\n` +
      `Q: "How long should I warm up?"\n` +
      `A: "Five to seven minutes — easy walk into a slow jog, plus calf raises."\n` +
      `\n` +
      `Q: "Should I push harder on Friday's run, given how good last Tuesday felt?"\n` +
      `A: "Hold the line. Your foot pain trended 2→4→5 over the last three runs — that's edging toward our freeze threshold. Stick with the planned 5×600m at current effort, and if pain stays under 3 this week, we add a rep next Tuesday."\n\n` +
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
