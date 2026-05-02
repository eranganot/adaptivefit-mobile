import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, goals, oauthTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SettingsClient } from "./SettingsClient";

type Goal = {
  id: string;
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

  // Get active goal
  let activeGoal: Goal | null = null;
  try {
    const goalResult = await db
      .select()
      .from(goals)
      .where(eq(goals.userId, user.id))
      .limit(1);

    if (goalResult && goalResult.length > 0) {
      activeGoal = goalResult[0] as Goal;
    }
  } catch (error) {
    console.error("Error fetching active goal:", error);
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

  return <SettingsClient locale={locale} activeGoal={activeGoal} fitToken={fitToken} />;
}
