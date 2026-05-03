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
} from "@/lib/db/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
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

    // 4. Load coach state + recent logs for FSM
    const [stateRow, recentRaw] = await Promise.all([
      db.query.userLevelState.findFirst({ where: eq(userLevelState.userId, user.id) }),
      db.select().from(workoutLogs).where(eq(workoutLogs.userId, user.id)).orderBy(desc(workoutLogs.performedAt)).limit(14),
    ]);

    const sentiments =
      recentRaw.length > 0
        ? await db.select().from(feedbackSentiment).where(inArray(feedbackSentiment.workoutLogId, recentRaw.map((l) => l.id)))
        : [];
    const sentMap = new Map(sentiments.map((s) => [s.workoutLogId, s]));
    const logsWithSentiment = recentRaw.map((l) => ({ ...l, sentiment: sentMap.get(l.id) ?? null }));

    const coachResult = evaluateCoach({
      recentLogs: logsWithSentiment,
      state: stateRow ?? { userId: user.id, currentLevel: 1, greenSessionCount: 0, freezeActive: false, freezeReason: null, lastEvaluatedAt: null },
      today: new Date(),
    });

    const { currentLevel, greenSessionCount, freezeActive, freezeReason } = coachResult.newState;
    await db
      .insert(userLevelState)
      .values({ userId: user.id, currentLevel, greenSessionCount, freezeActive, freezeReason, lastEvaluatedAt: new Date() })
      .onConflictDoUpdate({
        target: userLevelState.userId,
        set: { currentLevel, greenSessionCount, freezeActive, freezeReason, lastEvaluatedAt: new Date() },
      });

    // Regenerate roadmap if coach FSM triggered a freeze or level promotion
    const prevLevel = stateRow?.currentLevel ?? 1;
    const prevFreeze = stateRow?.freezeActive ?? false;
    const shouldRegen =
      (freezeActive && !prevFreeze) ||          // freeze just activated
      currentLevel > prevLevel;                  // level promoted
    if (shouldRegen) {
      try {
        await regenerateRoadmapForUser(user.id);
      } catch (e) {
        console.error("regenerateRoadmap non-fatal:", e);
      }
    }

    // 5. Gemini post-workout summary
    const recentRpe = recentRaw.map((l) => l.rpe).slice(0, 7);
    const { summary, adjustments } = await summarizePostWorkout({ rpe, footPain, notes, currentLevel, recentRpe });

    revalidatePath("/home");
    revalidatePath("/roadmap");

    return { success: true, workoutLogId: log.id, summary, adjustments };
  } catch (err) {
    console.error("logManualWorkout error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function coachChatTurn(
  message: string,
  workoutLogId: string,
): Promise<{ reply: string } | { error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { error: "User not found" };

    // Enforce 20-message cap (10 turns)
    const existing = await db.select().from(coachChatMessages).where(
      and(eq(coachChatMessages.userId, user.id), eq(coachChatMessages.workoutLogId, workoutLogId)),
    );
    if (existing.length >= 20) return { error: "Chat limit reached (10 turns)" };

    await db.insert(coachChatMessages).values({ userId: user.id, workoutLogId, role: "user", content: message });

    // Last 10 messages for context
    const context = await db
      .select()
      .from(coachChatMessages)
      .where(and(eq(coachChatMessages.userId, user.id), eq(coachChatMessages.workoutLogId, workoutLogId)))
      .orderBy(desc(coachChatMessages.createdAt))
      .limit(10);

    const history = context
      .reverse()
      .map((m) => `${m.role === "user" ? "Athlete" : "Coach"}: ${m.content}`)
      .join("\n");

    const model = gemini().getGenerativeModel({
      model: MODELS.FAST,
      systemInstruction:
        "You are a conservative running coach. The athlete just logged a workout. Respond in 2-3 concise sentences.",
      generationConfig: { temperature: 0.5, maxOutputTokens: 150 },
    });

    const res = await model.generateContent(
      `${history}\n\nAthlete: ${message}\n\nCoach:`,
    );
    const reply = res.response.text().trim();

    await db.insert(coachChatMessages).values({ userId: user.id, workoutLogId, role: "assistant", content: reply });

    return { reply };
  } catch (err) {
    console.error("coachChatTurn error:", err);
    return { error: err instanceof Error ? err.message : "Chat error" };
  }
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
