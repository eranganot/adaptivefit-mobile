import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, goals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

  return <SettingsClient locale={locale} activeGoal={activeGoal} />;
}
