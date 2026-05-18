import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, goals, userLevelState, bodyMetrics, fitDailyMetrics } from "@/lib/db/schema";
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

  // Health Connect status (Phase 8 — replaces Google Fit OAuth tokens).
  // Health Connect is on-device and has no cloud auth, so "last sync" is
  // simply the most recent fitDailyMetrics.updatedAt row for this user.
  let healthConnectLastSyncAt: Date | null = null;
  try {
    const latest = await db.query.fitDailyMetrics.findFirst({
      where: eq(fitDailyMetrics.userId, user.id),
      orderBy: [desc(fitDailyMetrics.updatedAt)],
      columns: { updatedAt: true },
    });
    healthConnectLastSyncAt = latest?.updatedAt ?? null;
  } catch (e) {
    console.error("Error fetching health-connect status:", e);
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
      healthConnectLastSyncAt={healthConnectLastSyncAt}
      levelState={levelState}
      weightEntries={weightEntries}
    />
  );
}
