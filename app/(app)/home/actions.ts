"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workoutLogs,
  workoutPhotos,
  coachChatMessages,
  runSessions,
  users,
  userLevelState,
  feedbackSentiment,
  goals,
} from "@/lib/db/schema";
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

    // 1. Insert workout log
    const [log] = await db
      .insert(workoutLogs)
      .values({ userId: user.id, performedAt: new Date(), type: "run", rpe, footPain, notesRaw: notes || null })
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

export async function coachChatTurn(
  message: string,
  workoutLogId: string,
): Promise<CoachChatResult> {
  // 1. Auth + user lookup
  let userId: string;
  try {
    const session = await auth();
    if (!session?.user?.email) return { error: "Not authenticated", code: "auth" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { error: "User not found", code: "auth" };
    userId = user.id;
  } catch (err) {
    console.error("coachChatTurn auth/user error:", err);
    return { error: err instanceof Error ? err.message : "Auth error", code: "auth" };
  }

  // 2. 20-message cap (10 turns)
  try {
    const existing = await db.select().from(coachChatMessages).where(
      and(eq(coachChatMessages.userId, userId), eq(coachChatMessages.workoutLogId, workoutLogId)),
    );
    if (existing.length >= 20) {
      return { error: "Chat limit reached (10 turns)", code: "limit" };
    }
  } catch (err) {
    console.error("coachChatTurn cap-check db error:", err);
    return { error: err instanceof Error ? err.message : "Database error", code: "db" };
  }

  // 3. Persist user message + load context (history + workout details + goal + state)
  let history: string;
  let workoutContext = "";
  let goalContext = "";
  let stateContext = "";
  let detectedLocale: "en" | "he" = "en";
  try {
    await db.insert(coachChatMessages).values({ userId, workoutLogId, role: "user", content: message });

    const context = await db
      .select()
      .from(coachChatMessages)
      .where(and(eq(coachChatMessages.userId, userId), eq(coachChatMessages.workoutLogId, workoutLogId)))
      .orderBy(desc(coachChatMessages.createdAt))
      .limit(10);

    history = context
      .reverse()
      .map((m) => `${m.role === "user" ? "Athlete" : "Coach"}: ${m.content}`)
      .join("\n");

    // Detect locale: Hebrew chars in messages or workout note → reply in Hebrew
    const hebrewRe = /[֐-׿]/;
    if (hebrewRe.test(message)) detectedLocale = "he";

    // Pull the workout this thread is about + its sentiment, so the coach
    // can ground replies in actual data instead of generic platitudes.
    const workout = await db.query.workoutLogs.findFirst({
      where: eq(workoutLogs.id, workoutLogId),
    });
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

      if (workout.notesLocale === "he") detectedLocale = "he";
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
  } catch (err) {
    console.error("coachChatTurn persist/context db error:", err);
    return { error: err instanceof Error ? err.message : "Database error", code: "db" };
  }

  // 4. Gemini call
  let reply: string;
  try {
    const localeInstruction =
      detectedLocale === "he"
        ? "The athlete writes in Hebrew. Reply in Hebrew."
        : "The athlete writes in English. Reply in English.";

    const systemInstruction =
      `You are an experienced personal running coach for Eran. ` +
      `Eran is a runner currently rehabbing plantar fasciitis (foot pain), so you prioritize injury prevention and conservative progression over chasing volume or speed. ` +
      `\n\nCoaching style:\n` +
      `- Be specific and actionable. Reference Eran's actual workout details (distance, RPE, pain, symptoms, notes) when answering — don't reply with generic platitudes.\n` +
      `- Match the depth of the question. A short check-in deserves a short answer; a substantive question deserves a thoughtful 4-8 sentence reply with reasoning.\n` +
      `- Ask follow-up questions when something is unclear or when more context would help (e.g. "Where exactly is the pain — heel, arch, or forefoot?").\n` +
      `- Talk like a real coach who knows the athlete: warm, candid, willing to push back gently when the athlete proposes something risky for the rehab.\n` +
      `- Use concrete training language: pace ranges, RPE targets, time-on-feet, recovery cues. Avoid vague phrases like "a well-structured workout."\n` +
      `- If recommending changes (rest day, swap workout, reduce volume), explain WHY based on the data above.\n` +
      `- Never recommend pushing through sharp foot pain.\n\n` +
      localeInstruction;

    const userPrompt =
      [workoutContext, goalContext, stateContext]
        .filter((s) => s.length > 0)
        .join("\n") +
      `\n\n## Conversation so far\n${history || "(this is the first message)"}\n\n` +
      `Now respond to the athlete's latest message as their coach.`;

    const model = gemini().getGenerativeModel({
      model: MODELS.FAST,
      systemInstruction,
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
    });

    const res = await model.generateContent(userPrompt);
    reply = res.response.text().trim();
    if (!reply) {
      // Gemini returned empty text (content filter or empty completion) — surface as gemini error
      return { error: "Coach returned empty reply", code: "gemini" };
    }
  } catch (err) {
    console.error("coachChatTurn gemini error:", err);
    return { error: err instanceof Error ? err.message : "Gemini error", code: "gemini" };
  }

  // 5. Persist assistant reply (non-fatal — user already saw the typing indicator end with their message)
  try {
    await db.insert(coachChatMessages).values({ userId, workoutLogId, role: "assistant", content: reply });
  } catch (err) {
    console.error("coachChatTurn persist-reply db error (non-fatal):", err);
    // Still return the reply to the user — it's better than nothing.
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

    const rows = await db
      .select()
      .from(coachChatMessages)
      .where(
        and(
          eq(coachChatMessages.userId, user.id),
          eq(coachChatMessages.workoutLogId, workoutLogId),
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
