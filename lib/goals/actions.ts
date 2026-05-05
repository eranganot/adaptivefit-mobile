"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { goals, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const SaveGoalSchema = z.object({
  category: z.enum(["running", "body_shape", "weight_loss", "strength"]).default("running"),
  type: z.enum(["5k_time", "10k_time", "weekly_volume_km", "sessions_per_week", "custom"]).default("custom"),
  targetValue: z.number().positive(),
  targetUnit: z.enum(["sec", "km", "sessions", "free", "kg", "pct"]),
  targetDate: z.string().min(1, "Target date is required"),
  note: z.string().optional(),
  // Bug #6 extras
  trainingMixPct: z.number().int().min(0).max(100).optional(),
  currentValue: z.number().optional(),
  targetLifts: z.object({
    bench5rm: z.number().optional(),
    squat5rm: z.number().optional(),
    deadlift5rm: z.number().optional(),
  }).optional(),
  sessionsPerWeek: z.number().int().min(1).max(7).optional(),
});

export type SaveGoalInput = z.infer<typeof SaveGoalSchema>;

export async function saveGoal(
  input: SaveGoalInput,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const validated = SaveGoalSchema.parse(input);

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    // R3: Multiple active goals allowed — just insert without archiving existing ones
    // Insert new active goal
    await db.insert(goals).values({
      userId: user.id,
      category: validated.category,
      type: validated.type,
      targetValue: validated.targetValue.toString(),
      targetUnit: validated.targetUnit,
      targetDate: validated.targetDate,
      note: validated.note || null,
      status: "active",
      trainingMixPct: validated.trainingMixPct ?? null,
      currentValue: validated.currentValue != null ? validated.currentValue.toString() : null,
      targetLifts: validated.targetLifts ?? null,
      sessionsPerWeek: validated.sessionsPerWeek ?? null,
    });

    revalidatePath("/home");
    revalidatePath("/settings");
    return { success: true };
  } catch (e) {
    console.error("[saveGoal] error:", e);
    return { success: false, error: "Failed to save goal. Please try again." };
  }
}

/** R3: Archive a specific goal by ID (used in multi-goal settings UI) */
export async function archiveGoalById(
  goalId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });
    if (!user) return { success: false, error: "User not found" };

    await db
      .update(goals)
      .set({ status: "archived" })
      .where(and(eq(goals.id, goalId), eq(goals.userId, user.id)));

    revalidatePath("/home");
    revalidatePath("/settings");
    return { success: true };
  } catch (e) {
    console.error("[archiveGoalById] error:", e);
    return { success: false, error: "Failed to archive goal." };
  }
}

export async function archiveGoalAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const goalId = formData.get("goalId") as string | null;
  if (!goalId) redirect("/settings");

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) redirect("/settings");

  await db
    .update(goals)
    .set({ status: "archived" })
    .where(and(eq(goals.id, goalId), eq(goals.userId, user.id)));

  revalidatePath("/home");
  revalidatePath("/settings");
  redirect("/settings");
}
