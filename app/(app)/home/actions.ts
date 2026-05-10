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
      and(eq(coachChatMessages.userId, userId), eq(coachChatMessages.workoutLogId, workoutLogId)),
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
    await db.insert(coachChatMessages).values({ userId, workoutLogId, role: "user", content: message });

    // Load last N (CHAT_CONTEXT_WINDOW), reverse to oldest-first.
    // The user's just-inserted message is the last entry; we'll strip it before
    // passing as history (since the API treats the latest user message as the
    // turn we're sending).
    const recent = await db
      .select()
      .from(coachChatMessages)
      .where(and(eq(coachChatMessages.userId, userId), eq(coachChatMessages.workoutLogId, workoutLogId)))
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

  // 4. Gemini call — chat session, English-only, 4096 token budget.
  //
  // Model choice: gemini-2.5-flash. We tried gemini-2.5-pro but the
  // @google/generative-ai SDK (0.21) doesn't handle Pro's thinking-token
  // accounting properly — Pro consumes the maxOutputTokens budget on internal
  // reasoning that doesn't appear in response.text(), producing empty replies.
  // Flash works cleanly with the existing SDK and at 4096 tokens with the
  // strong system prompt below it produces solid coaching prose.
  let reply: string;
  const modelName = MODELS.FAST; // gemini-2.5-flash
  try {
    const athleteName = displayName?.trim() || "Eran";

    const systemInstruction =
      `You are an experienced personal running coach for ${athleteName}. ` +
      `${athleteName} is a runner currently rehabbing plantar fasciitis (foot pain). Your job is to give specific, ` +
      `data-grounded coaching that prioritizes injury prevention and conservative progression over chasing volume or speed.\n\n` +
      `## Hard rules\n` +
      `- ALWAYS reply in English, even if the athlete writes in Hebrew or another language. The athlete is bilingual; English is more token-efficient.\n` +
      `- ALWAYS finish your sentences. Never end mid-word or mid-clause. If you're running out of room, wrap up cleanly rather than cutting off.\n` +
      `- Never recommend pushing through sharp foot pain.\n` +
      `- Refer to the athlete by name (${athleteName}). Don't transliterate or shorten the name.\n\n` +
      `## Coaching style\n` +
      `- Be specific and actionable. Reference the athlete's actual workout data (distance, RPE, pain, symptoms, notes) when answering. Don't reply with generic platitudes.\n` +
      `- Match the depth of the question. A short check-in deserves a 1-2 sentence reply; a substantive question deserves a thoughtful 4-8 sentence reply with reasoning.\n` +
      `- Ask follow-up questions when more context would help (e.g. "Where exactly is the pain — heel, arch, or forefoot?").\n` +
      `- Use concrete training language: pace ranges, RPE targets, time-on-feet, recovery cues. Avoid vague phrases like "a well-structured workout."\n` +
      `- Be warm, candid, willing to push back gently when the athlete proposes something risky for the rehab.\n` +
      `- If recommending changes (rest day, swap workout, reduce volume), explain WHY based on the data above. (You can suggest these in plain text — a future version of the app will let you propose plan changes that the athlete approves.)\n\n` +
      `## Example of a good substantive reply\n` +
      `Q: "Should I push harder on Friday's run?"\n` +
      `A: "Tempting, but I'd hold the line, ${athleteName}. Your foot pain on the last two runs was 4 and 5 — both above the 3 we use as a green-light threshold. Pushing intensity Friday risks bumping that into the 6+ range and triggering a freeze week. Stick with the planned 5×600m at your current effort target, and let's reassess after Sunday. If pain stays under 3 across both runs this week, we'll add a rep next Tuesday."\n`;

    const model = gemini().getGenerativeModel({
      model: modelName,
      systemInstruction,
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
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
    reply = res.response.text().trim();
    if (!reply) {
      return { error: "Coach returned empty reply", code: "gemini" };
    }
  } catch (err) {
    console.error("coachChatTurn gemini error:", err);
    return { error: err instanceof Error ? err.message : "Gemini error", code: "gemini" };
  }

  // 5. Persist assistant reply with the model name stamped (non-fatal)
  try {
    await db.insert(coachChatMessages).values({
      userId,
      workoutLogId,
      role: "assistant",
      content: reply,
      modelUsed: modelName,
    });
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
