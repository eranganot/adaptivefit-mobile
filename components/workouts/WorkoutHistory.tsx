import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workoutLogs, feedbackSentiment, users } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

const TYPE_ICONS: Record<string, string> = {
  run: "🏃",
  strength: "💪",
  mobility: "🧘",
  other: "⚡",
};

const SENTIMENT_STYLES: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  concern: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
};

const SENTIMENT_LABELS: Record<string, string> = {
  positive: "✓ Good",
  neutral: "– OK",
  concern: "⚠ Watch",
};

function formatDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function formatPace(secPerKm: number | null): string {
  if (!secPerKm) return "";
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function formatDate(d: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export async function WorkoutHistory() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) return null;

  const logs = await db.query.workoutLogs.findMany({
    where: eq(workoutLogs.userId, user.id),
    orderBy: [desc(workoutLogs.performedAt)],
    limit: 15,
  });

  if (logs.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground py-6">
        No workouts logged yet — your history will appear here.
      </p>
    );
  }

  const sentiments =
    logs.length > 0
      ? await db
          .select()
          .from(feedbackSentiment)
          .where(inArray(feedbackSentiment.workoutLogId, logs.map((l) => l.id)))
      : [];

  const sentMap = new Map(sentiments.map((s) => [s.workoutLogId, s]));

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        History
      </h2>
      <div className="space-y-2">
        {logs.map((log) => {
          const sent = sentMap.get(log.id) ?? null;
          const dist = log.distanceKm ? parseFloat(log.distanceKm) : null;

          return (
            <div
              key={log.id}
              className="rounded-2xl border bg-card p-4 text-card-foreground shadow-sm"
            >
              {/* ── Header row ── */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>
                    {TYPE_ICONS[log.type] ?? "⚡"}
                  </span>
                  <div>
                    <p className="text-sm font-semibold capitalize">{log.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(new Date(log.performedAt))}
                    </p>
                  </div>
                </div>
                {sent && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SENTIMENT_STYLES[sent.overallSentiment]}`}
                  >
                    {SENTIMENT_LABELS[sent.overallSentiment]}
                  </span>
                )}
              </div>

              {/* ── Stats row ── */}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {dist !== null && (
                  <span className="text-sm font-medium">{dist.toFixed(1)} km</span>
                )}
                {log.durationSec && (
                  <span className="text-sm text-muted-foreground">
                    {formatDuration(log.durationSec)}
                  </span>
                )}
                {log.paceSecPerKm && (
                  <span className="text-sm text-muted-foreground">
                    {formatPace(log.paceSecPerKm)}
                  </span>
                )}
                <span className="text-sm text-muted-foreground">RPE {log.rpe}/10</span>
                {log.footPain > 0 && (
                  <span className="text-sm text-amber-600 dark:text-amber-400">
                    🦶 {log.footPain}/10
                  </span>
                )}
              </div>

              {/* ── AI summary ── */}
              {sent?.aiSummaryEn && (
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  {sent.aiSummaryEn}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
