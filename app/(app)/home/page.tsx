import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { workoutLogs, userLevelState, users, feedbackSentiment, trainingRoadmap, coachChatMessages, goals } from "@/lib/db/schema";
import { eq, desc, gte, and, inArray, count } from "drizzle-orm";
import { evaluateCoach } from "@/lib/coach";
import type { GoalCategory, SessionPlan } from "@/lib/coach";
import HomeClient from "@/components/home/HomeClient";
import { getPendingColdStart, ensureColdStartExists } from "./coldStartActions";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const hour = new Date().getHours();
  const greetingKey =
    hour < 12 ? "greetingMorning" : hour < 18 ? "greetingAfternoon" : "greetingEvening";
  const name = session.user.name?.split(" ")[0] ?? "there";

  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
  if (!user) redirect("/sign-in");

  // Count today's logs and get the most recent one
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [todayCountResult, todayLog] = await Promise.all([
    db
      .select({ value: count() })
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, todayStart))),
    db.query.workoutLogs.findFirst({
      where: and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, todayStart)),
      orderBy: [desc(workoutLogs.performedAt)],
    }),
  ]);
  const todayLogCount = todayCountResult[0]?.value ?? 0;
  const loggedToday = todayLogCount > 0;

  // AI summary for today's most recent log (if already logged)
  let aiSummary: string | null = null;
  if (todayLog) {
    const sent = await db.query.feedbackSentiment.findFirst({
      where: eq(feedbackSentiment.workoutLogId, todayLog.id),
    });
    aiSummary = sent?.aiSummaryEn ?? null;
  }

  // Coach state + recent logs + active goal for plan
  const [stateRow, recentRaw, activeGoal] = await Promise.all([
    db.query.userLevelState.findFirst({ where: eq(userLevelState.userId, user.id) }),
    db.select().from(workoutLogs).where(
      and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d; })()))
    ).orderBy(desc(workoutLogs.performedAt)).limit(20),
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

  // Next pending roadmap session (Bug #4: shown when already logged today)
  let nextSession: { title: string; date: Date; plan: SessionPlan } | null = null;
  if (loggedToday) {
    try {
      const today = new Date();
      const dayOfWeek = today.getDay();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      startOfWeek.setHours(0, 0, 0, 0);

      const pendingRows = await db
        .select()
        .from(trainingRoadmap)
        .where(
          and(
            eq(trainingRoadmap.userId, user.id),
            eq(trainingRoadmap.status, "pending"),
          ),
        )
        .orderBy(trainingRoadmap.weekIndex, trainingRoadmap.dayIndex)
        .limit(5);

      // Find the first session that is in the future
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      for (const row of pendingRows) {
        const sessionDate = new Date(startOfWeek);
        sessionDate.setDate(startOfWeek.getDate() + row.weekIndex * 7 + row.dayIndex);
        if (sessionDate > todayDate) {
          nextSession = {
            title: (row.sessionPlan as SessionPlan).title,
            date: sessionDate,
            plan: row.sessionPlan as SessionPlan,
          };
          break;
        }
      }
    } catch (e) {
      console.error("nextSession non-fatal:", e);
    }
  }

  // Last 2 coach messages for chat preview (Bug #4)
  let lastChatMessages: { role: string; content: string }[] = [];
  if (todayLog) {
    try {
      const msgs = await db
        .select({ role: coachChatMessages.role, content: coachChatMessages.content })
        .from(coachChatMessages)
        .where(eq(coachChatMessages.workoutLogId, todayLog.id))
        .orderBy(desc(coachChatMessages.createdAt))
        .limit(2);
      lastChatMessages = msgs.reverse();
    } catch (e) {
      console.error("lastChatMessages non-fatal:", e);
    }
  }

  // Cold-start pending recommendation (Bug #8)
  // Ensure first-time users (no level state + no pending cold-start) get the onboarding modal
  if (!stateRow) {
    await ensureColdStartExists(user.id).catch(() => null);
  }
  const pendingColdStart = await getPendingColdStart().catch(() => null);

  // Yesterday's Fit stats (shown only if Google Fit connected)
  let fitYesterday: { steps: number | null; activeMinutes: number | null } | null = null;
  try {
    const fitConnected = await db.query.oauthTokens.findFirst({
      where: (t, { and }) => and(eq(t.userId, user.id), eq(t.provider, "google_fit"), eq(t.status, "active")),
    });
    if (fitConnected) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yDate = yesterday.toISOString().slice(0, 10);
      const metric = await db.query.fitDailyMetrics.findFirst({
        where: (t, { and }) => and(eq(t.userId, user.id), eq(t.date, yDate)),
      });
      if (metric) fitYesterday = { steps: metric.steps, activeMinutes: metric.activeMinutes };
    }
  } catch (e) {
    console.error("fitYesterday non-fatal:", e);
  }

  return (
    <HomeClient
      name={name}
      greetingKey={greetingKey as "greetingMorning" | "greetingAfternoon" | "greetingEvening"}
      todayPlan={coachResult.todayPlan}
      coachLevel={stateRow?.currentLevel ?? 1}
      freezeActive={stateRow?.freezeActive ?? false}
      freezeReason={stateRow?.freezeReason ?? null}
      loggedToday={loggedToday}
      todayLogCount={todayLogCount}
      aiSummary={aiSummary}
      workoutLogId={todayLog?.id ?? null}
      fitYesterday={fitYesterday}
      nextSession={nextSession}
      lastChatMessages={lastChatMessages}
      pendingColdStart={pendingColdStart}
    />
  );
}
