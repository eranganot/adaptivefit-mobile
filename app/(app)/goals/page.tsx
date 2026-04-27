import { auth } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { goals, users, workoutLogs } from "@/lib/db/schema";
import { eq, and, gte, sum } from "drizzle-orm";
import Link from "next/link";
import { GoalForm } from "@/components/goals/GoalForm";
import { archiveGoalAction } from "./actions";
import type { Goal } from "@/lib/db/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

function secToMmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTarget(goal: Goal): string {
  const v = parseFloat(goal.targetValue);
  if (goal.targetUnit === "sec") return secToMmss(Math.round(v));
  if (goal.targetUnit === "km") return `${v} km/wk`;
  if (goal.targetUnit === "sessions") return `${v}×/wk`;
  return goal.targetValue;
}

function daysRemaining(targetDate: string): number {
  const target = new Date(targetDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const GOAL_TYPE_LABELS: Record<string, string> = {
  "5k_time": "5k Time",
  "10k_time": "10k Time",
  weekly_volume_km: "Weekly Volume",
  sessions_per_week: "Sessions / Week",
  custom: "Custom",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const session = await auth();
  const t = await getTranslations("goals");

  const user = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
    : null;

  const activeGoal = user
    ? await db.query.goals.findFirst({
        where: and(eq(goals.userId, user.id), eq(goals.status, "active")),
      })
    : null;

  // ── Volume progress for km/sessions goals ──
  let progressPct: number | null = null;
  if (activeGoal && user && ["weekly_volume_km", "sessions_per_week"].includes(activeGoal.type)) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (activeGoal.type === "weekly_volume_km") {
      const [row] = await db
        .select({ total: sum(workoutLogs.distanceKm) })
        .from(workoutLogs)
        .where(and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, sevenDaysAgo)));
      const done = parseFloat(row?.total ?? "0");
      const target = parseFloat(activeGoal.targetValue);
      progressPct = target > 0 ? Math.min(Math.round((done / target) * 100), 100) : null;
    } else if (activeGoal.type === "sessions_per_week") {
      const logs = await db.query.workoutLogs.findMany({
        where: and(eq(workoutLogs.userId, user.id), gte(workoutLogs.performedAt, sevenDaysAgo)),
      });
      const done = logs.length;
      const target = parseFloat(activeGoal.targetValue);
      progressPct = target > 0 ? Math.min(Math.round((done / target) * 100), 100) : null;
    }
  }

  const isNewOrEdit = mode === "new" || mode === "edit";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {activeGoal && !isNewOrEdit && (
          <Link
            href="/goals?mode=edit"
            className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground"
          >
            {t("edit")}
          </Link>
        )}
      </div>

      {isNewOrEdit ? (
        <GoalForm
          initialType={activeGoal?.type as Parameters<typeof GoalForm>[0]["initialType"]}
          initialTargetValue={activeGoal ? parseFloat(activeGoal.targetValue) : undefined}
          initialTargetDate={activeGoal?.targetDate ?? undefined}
          initialNote={activeGoal?.note ?? undefined}
        />
      ) : activeGoal ? (
        <>
          {/* ── Active goal card ── */}
          <div className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {GOAL_TYPE_LABELS[activeGoal.type] ?? activeGoal.type}
            </p>
            <p className="mt-1 text-3xl font-bold tracking-tight">
              {formatTarget(activeGoal)}
            </p>

            {activeGoal.note && (
              <p className="mt-1 text-sm text-muted-foreground">{activeGoal.note}</p>
            )}

            {/* Days remaining */}
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {(() => {
                  const days = daysRemaining(activeGoal.targetDate);
                  if (days < 0) return "Past target date";
                  if (days === 0) return "Target date: today";
                  return `${days} day${days === 1 ? "" : "s"} to go`;
                })()}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-sm text-muted-foreground">
                {new Date(activeGoal.targetDate).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>

            {/* Progress bar (only for km/sessions goals) */}
            {progressPct !== null && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>This week</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Archive form ── */}
          <form action={archiveGoalAction}>
            <input type="hidden" name="goalId" value={activeGoal.id} />
            <button
              type="submit"
              className="w-full rounded-xl border border-destructive/30 px-4 py-3 text-sm font-medium text-destructive/80 transition-colors hover:bg-destructive/5"
            >
              {t("archive")}
            </button>
          </form>

          {/* ── Replace CTA ── */}
          <Link
            href="/goals?mode=new"
            className="block w-full rounded-xl border border-border px-4 py-3 text-center text-sm font-medium text-muted-foreground"
          >
            Replace with new goal
          </Link>
        </>
      ) : (
        /* ── Empty state ── */
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed bg-card p-10 text-center text-card-foreground">
          <p className="text-muted-foreground">{t("empty")}</p>
          <Link
            href="/goals?mode=new"
            className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm"
          >
            {t("setFirst")}
          </Link>
        </div>
      )}
    </div>
  );
}
