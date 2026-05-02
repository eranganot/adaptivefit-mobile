import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { workoutLogs, userLevelState, users, feedbackSentiment } from "@/lib/db/schema";
import { eq, desc, gte, and, inArray } from "drizzle-orm";
import { evaluateCoach } from "@/lib/coach";
import HomeClient from "@/components/home/HomeClient";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const hour = new Date().getHours();
  const greetingKey =
    hour < 12 ? "greetingMorning" : hour < 18 ? "greetingAfternoon" : "greetingEvening";
  const name = session.user.name?.split(" ")[0] ?? "there";

  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
  if (!user) redirect("/sign-in");

  // Check today's log
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayLog = await db.query.workoutLogs.findFirst({
    where: and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, todayStart)),
  });
  const loggedToday = !!todayLog;

  // AI summary for today (if already logged)
  let aiSummary: string | null = null;
  if (todayLog) {
    const sent = await db.query.feedbackSentiment.findFirst({
      where: eq(feedbackSentiment.workoutLogId, todayLog.id),
    });
    aiSummary = sent?.aiSummaryEn ?? null;
  }

  // Coach state + recent logs for plan
  const [stateRow, recentRaw] = await Promise.all([
    db.query.userLevelState.findFirst({ where: eq(userLevelState.userId, user.id) }),
    db.select().from(workoutLogs).where(
      and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d; })()))
    ).orderBy(desc(workoutLogs.performedAt)).limit(20),
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
      aiSummary={aiSummary}
      workoutLogId={todayLog?.id ?? null}
      fitYesterday={fitYesterday}
    />
  );
}
