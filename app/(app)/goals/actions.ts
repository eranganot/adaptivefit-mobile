"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { goals, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const SaveGoalSchema = z.object({
  type: z.enum(["5k_time", "10k_time", "weekly_volume_km", "sessions_per_week", "custom"]),
  targetValue: z.number().positive(),
  targetUnit: z.enum(["sec", "km", "sessions", "free"]),
  targetDate: z.string().min(1, "Target date is required"),
  note: z.string().optional(),
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

    // Archive any existing active goal
    await db
      .update(goals)
      .set({ status: "archived" })
      .where(and(eq(goals.userId, user.id), eq(goals.status, "active")));

    // Insert new active goal
    await db.insert(goals).values({
      userId: user.id,
      type: validated.type,
      targetValue: validated.targetValue.toString(),
      targetUnit: validated.targetUnit,
      targetDate: validated.targetDate,
      note: validated.note || null,
      status: "active",
    });

    revalidatePath("/goals");
    revalidatePath("/home");
    return { success: true };
  } catch (e) {
    console.error("[saveGoal] error:", e);
    return { success: false, error: "Failed to save goal. Please try again." };
  }
}

export async function archiveGoalAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const goalId = formData.get("goalId") as string | null;
  if (!goalId) redirect("/goals");

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) redirect("/goals");

  await db
    .update(goals)
    .set({ status: "archived" })
    .where(and(eq(goals.id, goalId), eq(goals.userId, user.id)));

  revalidatePath("/goals");
  revalidatePath("/home");
  redirect("/goals");
}
