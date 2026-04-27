import { auth } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { db } from "@/lib/db";
import { workoutLogs, userLevelState, users, feedbackSentiment } from "@/lib/db/schema";
import { eq, desc, gte, and, inArray } from "drizzle-orm";
import { evaluateCoach, type SessionPlan } from "@/lib/coach";

function formatPlanSubtitle(plan: SessionPlan): string {
  return plan.blocks
    .flatMap((b) => {
      if (b.kind === "warmup") return [`${b.durationMin} min warmup`];
      if (b.kind === "mobility") return [b.exercises.join(" · ")];
      if (b.kind === "rest") return ["Rest & mobility"];
      return [];
    })
    .join(" · ");
}

export default async function HomePage() {
  const session = await auth();
  const t = await getTranslations("home");
  const hour = new Date().getHours();
  const greetingKey =
    hour < 12 ? "greetingMorning" : hour < 18 ? "greetingAfternoon" : "greetingEvening";
  const name = session?.user?.name?.split(" ")[0] ?? "there";

  // ── Load dynamic data ──────────────────────────────────────────────────
  let todayPlan: SessionPlan | null = null;
  let coachLevel = 1;
  let freezeActive = false;
  let freezeReason: string | null = null;
  let loggedToday = false;
  let aiSummary: string | null = null;

  const user = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
    : null;

  if (user) {
    // Check if a workout was already logged today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayLog = await db.query.workoutLogs.findFirst({
      where: and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, todayStart)),
    });
    loggedToday = !!todayLog;

    // Get today's Gemini summary if logged
    if (todayLog) {
      const sent = await db.query.feedbackSentiment.findFirst({
        where: eq(feedbackSentiment.workoutLogId, todayLog.id),
      });
      aiSummary = sent?.aiSummaryEn ?? null;
    }

    // Coach state
    const state = await db.query.userLevelState.findFirst({
      where: eq(userLevelState.userId, user.id),
    });
    coachLevel = state?.currentLevel ?? 1;
    freezeActive = state?.freezeActive ?? false;
    freezeReason = state?.freezeReason ?? null;

    // Recent logs for coach plan
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const recentLogs = await db
      .select()
      .from(workoutLogs)
      .where(
        and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, fourteenDaysAgo)),
      )
      .orderBy(desc(workoutLogs.performedAt))
      .limit(20);

    const sentiments =
      recentLogs.length > 0
        ? await db
            .select()
            .from(feedbackSentiment)
            .where(inArray(feedbackSentiment.workoutLogId, recentLogs.map((l) => l.id)))
        : [];

    const sentimentMap = new Map(sentiments.map((s) => [s.workoutLogId, s]));
    const logsWithSentiment = recentLogs.map((l) => ({
      ...l,
      sentiment: sentimentMap.get(l.id) ?? null,
    }));

    const coachResult = evaluateCoach({
      recentLogs: logsWithSentiment,
      state: state ?? {
        userId: user.id,
        currentLevel: 1,
        greenSessionCount: 0,
        freezeActive: false,
        freezeReason: null,
        lastEvaluatedAt: null,
      },
      today: new Date(),
    });

    todayPlan = coachResult.todayPlan;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t(greetingKey, { name })}</h1>

      {/* Today's session card */}
      <div className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
        <p className="text-sm text-muted-foreground">{t("todayPlanned")}</p>
        <p className="mt-2 text-lg font-semibold">
          {todayPlan?.title ?? "3 × 1.5 km blocks @ 7:00 min/km"}
        </p>
        {todayPlan && (
          <p className="mt-1 text-sm text-muted-foreground">
            {formatPlanSubtitle(todayPlan)}
          </p>
        )}

        {loggedToday ? (
          <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            ✓ {t("alreadyLogged")}
            {aiSummary && (
              <p className="mt-1 text-xs font-normal opacity-80">{aiSummary}</p>
            )}
          </div>
        ) : (
          <Link
            href="/workouts"
            className="mt-4 block w-full rounded-xl bg-primary px-4 py-3 text-center font-semibold text-primary-foreground shadow-sm"
          >
            {t("logWorkout")}
          </Link>
        )}
      </div>

      {/* Coach state */}
      <div className="rounded-2xl border bg-card p-4 text-card-foreground shadow-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("coachState")}</p>
        {freezeActive ? (
          <p className="mt-1 font-medium text-amber-600 dark:text-amber-400">
            {t("freezeActive", { reason: freezeReason ?? "recovery" })}
          </p>
        ) : (
          <p className="mt-1 font-semibold">{t("level", { level: coachLevel })}</p>
        )}
      </div>
    </div>
  );
}
