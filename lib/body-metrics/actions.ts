"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { bodyMetrics, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

type Result = { success: true } | { success: false; error: string };

/**
 * Log (or update) a weight entry for the given date.
 * Uses INSERT … ON CONFLICT DO UPDATE (UPSERT) because the table
 * has a unique index on (user_id, date).
 */
export async function logWeight(
  weightKg: number,
  date?: string, // YYYY-MM-DD — defaults to today in Israel time
): Promise<Result> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    const entryDate =
      date ??
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

    if (weightKg <= 0 || weightKg > 500) {
      return { success: false, error: "Weight must be between 1 and 500 kg" };
    }

    await db
      .insert(bodyMetrics)
      .values({
        userId: user.id,
        date: entryDate,
        weightKg: weightKg.toFixed(2),
      })
      .onConflictDoUpdate({
        target: [bodyMetrics.userId, bodyMetrics.date],
        set: { weightKg: weightKg.toFixed(2) },
      });

    revalidatePath("/settings");
    revalidatePath("/analytics");
    return { success: true };
  } catch (e) {
    console.error("[logWeight] error:", e);
    return { success: false, error: "Failed to save weight entry." };
  }
}

/**
 * Delete a body metric entry by id (must belong to the current user).
 */
export async function deleteWeightEntry(id: string): Promise<Result> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    await db
      .delete(bodyMetrics)
      .where(and(eq(bodyMetrics.id, id), eq(bodyMetrics.userId, user.id)));

    revalidatePath("/settings");
    revalidatePath("/analytics");
    return { success: true };
  } catch (e) {
    console.error("[deleteWeightEntry] error:", e);
    return { success: false, error: "Failed to delete entry." };
  }
}
