"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workoutLogs,
  feedbackSentiment,
  coachChatMessages,
  runSessions,
  users,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { extractFeedback } from "@/lib/gemini/extractFeedback";
import { recomputeAfterChange } from "./recomputeAfterChange";
import { z } from "zod";

const UpdateWorkoutSchema = z.object({
  rpe: z.number().int().min(1).max(10),
  footPain: z.number().int().min(0).max(10),
  notes: z.string().optional(),
});

export type UpdateWorkoutInput = z.infer<typeof UpdateWorkoutSchema>;

export async function updateWorkout(
  id: string,
  input: UpdateWorkoutInput,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    // Validate ownership
    const existing = await db.query.workoutLogs.findFirst({
      where: and(eq(workoutLogs.id, id), eq(workoutLogs.userId, user.id)),
    });
    if (!existing) return { success: false, error: "Workout not found" };

    const validated = UpdateWorkoutSchema.parse(input);

    await db
      .update(workoutLogs)
      .set({
        rpe: validated.rpe,
        footPain: validated.footPain,
        notesRaw: validated.notes ?? null,
      })
      .where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, user.id)));

    // Re-run feedback extraction if notes/rpe/pain changed
    const noteChanged = (validated.notes ?? "") !== (existing.notesRaw ?? "");
    const rpeChanged = validated.rpe !== existing.rpe;
    const painChanged = validated.footPain !== existing.footPain;

    if (noteChanged || rpeChanged || painChanged) {
      try {
        // Delete old sentiment row then re-insert
        await db.delete(feedbackSentiment).where(eq(feedbackSentiment.workoutLogId, id));

        const fb = await extractFeedback({
          notes: validated.notes,
          type: existing.type,
          rpe: validated.rpe,
          footPain: validated.footPain,
        });
        await db.insert(feedbackSentiment).values({
          workoutLogId: id,
          overallSentiment: fb.data.overall_sentiment,
          symptoms: fb.data.symptoms,
          severity: fb.data.severity,
          aiSummaryEn: fb.data.ai_summary_en,
          aiSummaryHe: fb.data.ai_summary_he,
          geminiModel: fb.modelUsed,
        });
      } catch (e) {
        console.error("[updateWorkout] extractFeedback non-fatal:", e);
      }
    }

    await recomputeAfterChange(user.id);

    revalidatePath("/home");
    revalidatePath("/roadmap");
    return { success: true };
  } catch (e) {
    console.error("[updateWorkout] error:", e);
    return { success: false, error: "Failed to update workout. Please try again." };
  }
}

export async function deleteWorkout(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    // Validate ownership before deleting
    const existing = await db.query.workoutLogs.findFirst({
      where: and(eq(workoutLogs.id, id), eq(workoutLogs.userId, user.id)),
    });
    if (!existing) return { success: false, error: "Workout not found" };

    // Null-out any run_sessions FK before deleting
    try {
      await db
        .update(runSessions)
        .set({ workoutLogId: null })
        .where(eq(runSessions.workoutLogId, id));
    } catch (e) {
      console.error("[deleteWorkout] runSessions unlink non-fatal:", e);
    }

    // coach_chat_messages.workoutLogId → SET NULL handled by DB cascade,
    // feedback_sentiment → CASCADE DELETE handled by DB.
    await db
      .delete(workoutLogs)
      .where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, user.id)));

    await recomputeAfterChange(user.id);

    revalidatePath("/home");
    revalidatePath("/roadmap");
    return { success: true };
  } catch (e) {
    console.error("[deleteWorkout] error:", e);
    return { success: false, error: "Failed to delete workout. Please try again." };
  }
}

export type RecentWorkout = {
  id: string;
  performedAt: Date;
  type: string;
  rpe: number;
  footPain: number;
  distanceKm: string | null;
  durationSec: number | null;
  notesRaw: string | null;
};

/** Returns the user's most recent workout logs for the edit/delete sheet. */
export async function getRecentWorkouts(limit = 10): Promise<RecentWorkout[]> {
  try {
    const session = await auth();
    if (!session?.user?.email) return [];

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return [];

    const rows = await db
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, user.id))
      .orderBy(desc(workoutLogs.performedAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      performedAt: r.performedAt,
      type: r.type,
      rpe: r.rpe,
      footPain: r.footPain,
      distanceKm: r.distanceKm,
      durationSec: r.durationSec,
      notesRaw: r.notesRaw,
    }));
  } catch (e) {
    console.error("[getRecentWorkouts] error:", e);
    return [];
  }
}
