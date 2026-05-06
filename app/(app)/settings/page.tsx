import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, goals, oauthTokens, userLevelState, bodyMetrics } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SettingsClient } from "./SettingsClient";
import type { WeightEntry } from "@/components/settings/BodyMetricsSection";

export type SettingsGoal = {
  id: string;
  category: string;
  type: string;
  targetValue: string;
  targetDate: string;
  status: string;
  note: string | null;
};

export default async function SettingsPage() {
  // Get session
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/auth/signin");
  }

  // Get user from DB
  const userResult = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!userResult || userResult.length === 0) {
    redirect("/auth/signin");
  }

  const user = userResult[0];
  const locale = (user.locale as "en" | "he") || "en";

  // R3: Fetch ALL active goals (multi-goal support)
  let activeGoals: SettingsGoal[] = [];
  try {
    const goalRows = await db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, user.id), eq(goals.status, "active")))
      .orderBy(desc(goals.createdAt));

    activeGoals = goalRows.map((g) => ({
      id: g.id,
      category: g.category,
      type: g.type,
      targetValue: g.targetValue,
      targetDate: g.targetDate,
      status: g.status,
      note: g.note,
    }));
  } catch (error) {
    console.error("Error fetching active goals:", error);
  }

  // Get Google Fit connection status
  let fitToken: { status: string; lastSyncAt: Date | null } | null = null;
  try {
    const tokenRow = await db.query.oauthTokens.findFirst({
      where: and(eq(oauthTokens.userId, user.id), eq(oauthTokens.provider, "google_fit")),
    });
    if (tokenRow) {
      fitToken = { status: tokenRow.status, lastSyncAt: tokenRow.lastSyncAt };
    }
  } catch (e) {
    console.error("Error fetching Fit token:", e);
  }

  // Get coach level state (Bug #9)
  let levelState: { currentLevel: number; manualOverride: boolean; manualOverrideUntil: Date | null } | null = null;
  try {
    const stateRow = await db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    });
    if (stateRow) {
      levelState = {
        currentLevel: stateRow.currentLevel,
        manualOverride: stateRow.manualOverride ?? false,
        manualOverrideUntil: stateRow.manualOverrideUntil ?? null,
      };
    }
  } catch (e) {
    console.error("Error fetching level state:", e);
  }

  // A2: Fetch last 10 weight entries for the weight log section
  let weightEntries: WeightEntry[] = [];
  try {
    const rows = await db
      .select({ id: bodyMetrics.id, date: bodyMetrics.date, weightKg: bodyMetrics.weightKg })
      .from(bodyMetrics)
      .where(eq(bodyMetrics.userId, user.id))
      .orderBy(desc(bodyMetrics.date))
      .limit(10);

    weightEntries = rows
      .filter((r) => r.weightKg != null)
      .map((r) => ({
        id: r.id,
        date: r.date,
        weightKg: parseFloat(r.weightKg!),
      }));
  } catch (e) {
    console.error("Error fetching weight entries:", e);
  }

  return (
    <SettingsClient
      locale={locale}
      activeGoals={activeGoals}
      fitToken={fitToken}
      levelState={levelState}
      weightEntries={weightEntries}
    />
  );
}
