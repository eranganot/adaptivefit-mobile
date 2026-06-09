"use server";

/**
 * Server action feeding the on-device workout-reminder scheduler.
 *
 * Read-only and lightweight (no roadmap regen side effects) — it's called on
 * every app foreground, so it must stay cheap. Returns upcoming PLANNED
 * sessions with absolute local dates so the client can schedule local
 * notifications. Rest days are flagged so the client can skip them.
 *
 * Week anchor = Sunday, matching the rest of the app (see lib/dates/week.ts).
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs, users } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import type { SessionPlan } from "@/lib/coach";
import { startOfWeekSunday } from "@/lib/dates/week";
import type { PlannedSession } from "@/lib/notifications/types";

export async function getUpcomingPlannedSessions(): Promise<PlannedSession[]> {
  const session = await auth();
  if (!session?.user?.email) return [];

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) return [];

  const today = new Date();
  const startOfWeek = startOfWeekSunday(today);
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);

  // Roadmap rows for the current + next couple of weeks (the generator only
  // ever plans ~2 weeks ahead, but we read a little wider to be safe).
  const rows = await db
    .select()
    .from(trainingRoadmap)
    .where(
      and(
        eq(trainingRoadmap.userId, user.id),
        eq(trainingRoadmap.status, "pending"),
        gte(trainingRoadmap.weekIndex, 0),
      ),
    )
    .orderBy(trainingRoadmap.weekIndex, trainingRoadmap.dayIndex);

  // Logged workouts in the last/next window so we don't remind for a session
  // the user already completed today.
  const recentLogs = await db
    .select({ performedAt: workoutLogs.performedAt })
    .from(workoutLogs)
    .where(
      and(
        eq(workoutLogs.userId, user.id),
        gte(workoutLogs.performedAt, startOfWeek),
      ),
    );
  const loggedDateKeys = new Set(
    recentLogs.map((l) => toLocalDateKey(new Date(l.performedAt))),
  );

  const out: PlannedSession[] = [];
  for (const row of rows) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + row.weekIndex * 7 + row.dayIndex);
    d.setHours(0, 0, 0, 0);

    // Only future-or-today sessions matter for reminders.
    if (d.getTime() < todayMidnight.getTime()) continue;

    const dateISO = toLocalDateKey(d);
    if (loggedDateKeys.has(dateISO)) continue; // already trained that day

    const plan = row.sessionPlan as SessionPlan;
    const isRest = plan?.blocks?.every((b) => b.kind === "rest") ?? false;

    out.push({
      dateISO,
      title: plan?.title || "Workout",
      isRest,
    });
  }

  return out;
}

/** "YYYY-MM-DD" in local time (matches the keys buildSchedule expects). */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
