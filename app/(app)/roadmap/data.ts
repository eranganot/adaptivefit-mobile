import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs, goals } from "@/lib/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import type { SessionPlan, SessionBlock } from "@/lib/coach";
import { regenerateRoadmapForUser } from "@/lib/roadmap/regenerate";

export type RoadmapSession = {
  id: string;
  date: Date;
  title: string;
  status: "completed" | "adjusted" | "planned";
  blocks: Array<{ label: string; detail: string }>;
  adjustedNote?: string;
};

export async function getRoadmapData(userId: string): Promise<{
  sessions: RoadmapSession[];
  weekIndex: number;
  totalWeeks: number;
}> {
  // 1. Find active goal for this user
  const activeGoal = await db.query.goals.findFirst({
    where: and(eq(goals.userId, userId), eq(goals.status, "active")),
  });

  const totalWeeks = 12; // default planning horizon
  let weekIndex = 0;

  if (activeGoal?.targetDate) {
    // Calculate week index relative to today
    const today = new Date();
    const targetDate = new Date(activeGoal.targetDate);
    const weeksDiff = Math.floor((targetDate.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));
    weekIndex = Math.max(0, weeksDiff);
  }

  // 2. Get the current week boundaries (Monday = week start, index 0)
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  startOfWeek.setHours(0, 0, 0, 0);

  // 3. Query roadmap for next 14 days (2 weeks)
  const twoWeeksFromNow = new Date(startOfWeek);
  twoWeeksFromNow.setDate(startOfWeek.getDate() + 14);

  let roadmapRows = await db
    .select()
    .from(trainingRoadmap)
    .where(
      and(
        eq(trainingRoadmap.userId, userId),
        gte(trainingRoadmap.weekIndex, 0),
        lte(trainingRoadmap.weekIndex, 2),
      ),
    )
    .orderBy(trainingRoadmap.weekIndex, trainingRoadmap.dayIndex);

  // 4. Regenerate if: no roadmap exists OR all existing sessions are in the past
  const needsRegen = roadmapRows.length === 0 || roadmapRows.every((row) => {
    const sessionDate = new Date(startOfWeek);
    sessionDate.setDate(startOfWeek.getDate() + row.weekIndex * 7 + row.dayIndex);
    return sessionDate < today;
  });

  if (needsRegen) {
    await regenerateRoadmapForUser(userId);
    roadmapRows = await db
      .select()
      .from(trainingRoadmap)
      .where(
        and(
          eq(trainingRoadmap.userId, userId),
          gte(trainingRoadmap.weekIndex, 0),
          lte(trainingRoadmap.weekIndex, 2),
        ),
      )
      .orderBy(trainingRoadmap.weekIndex, trainingRoadmap.dayIndex);
  }

  // 5. Query workout logs for status matching
  const last14Days = new Date(today);
  last14Days.setDate(today.getDate() - 14);

  const recentLogs = await db
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, userId), gte(workoutLogs.performedAt, last14Days)))
    .orderBy(desc(workoutLogs.performedAt));

  // 6. Build sessions array with status derivation
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);

  const sessionsRaw: (RoadmapSession & { isPastPending: boolean })[] = roadmapRows.map((row) => {
    // Derive date: startOfWeek + (weekIndex * 7) + dayIndex
    const sessionDate = new Date(startOfWeek);
    sessionDate.setDate(startOfWeek.getDate() + row.weekIndex * 7 + row.dayIndex);

    // Check if completed: has a log on that day
    const logOnDay = recentLogs.find((log) => {
      const logDate = new Date(log.performedAt);
      logDate.setHours(0, 0, 0, 0);
      const checkDate = new Date(sessionDate);
      checkDate.setHours(0, 0, 0, 0);
      return logDate.getTime() === checkDate.getTime();
    });

    let status: "completed" | "adjusted" | "planned" = "planned";
    let adjustedNote: string | undefined;

    const plan = row.sessionPlan as SessionPlan;

    // Precedence: an actual logged workout on that day beats everything.
    // Previously "modified" (= the coach adjusted the row, e.g. to rest)
    // was checked first, so when the user trained anyway after a coach-
    // initiated rest swap, the card kept showing "Adjusted — rest day"
    // instead of "Completed". The athlete's actual action is the source
    // of truth.
    if (logOnDay || row.status === "completed") {
      status = "completed";
    } else if (row.status === "modified") {
      status = "adjusted";
      adjustedNote = plan.rationale || "Session was adjusted";
    }

    // A "past pending" row is one whose calendar date is in the past, was
    // never marked completed in DB, and has no matching log. These are stale
    // entries from a previous regen (e.g. the May 5 phantom) and should be
    // hidden from the user's forward-looking roadmap view.
    const sessionMidnight = new Date(sessionDate);
    sessionMidnight.setHours(0, 0, 0, 0);
    const isPastPending =
      status === "planned" && sessionMidnight.getTime() < todayMidnight.getTime();

    return {
      id: row.id,
      date: sessionDate,
      title: plan.title,
      status,
      blocks: plan.blocks.map((block) => ({
        label: formatBlockLabel(block),
        detail: formatBlockDetail(block),
      })),
      adjustedNote,
      isPastPending,
    };
  });

  // Hide past-pending rows from the roadmap view. They remain in the DB for
  // audit; they're just confusing as "next workout" framing.
  let sessions: RoadmapSession[] = sessionsRaw
    .filter((s) => !s.isPastPending)
    .map(({ isPastPending: _ignore, ...rest }) => rest);

  // If no session row exists for today, inject a synthetic "Rest day" card so
  // the user always sees something explicit for today instead of having to
  // infer "no card means rest" from absence. This card is purely display —
  // not stored in DB.
  const hasTodaySession = sessions.some((s) => {
    const d = new Date(s.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === todayMidnight.getTime();
  });
  if (!hasTodaySession) {
    const todayDate = new Date(todayMidnight);
    sessions = [
      {
        id: `synthetic-today-${todayDate.toISOString().slice(0, 10)}`,
        date: todayDate,
        title: "Rest day",
        status: "planned" as const,
        blocks: [
          { label: "Recovery", detail: "Easy walking, mobility, foam-rolling, or stretching" },
        ],
      },
      ...sessions,
    ];
  }

  // Drop sessions before today (Asia/Jerusalem). The Roadmap tab is a
  // forward-looking view — past "adjusted" and "completed" rows survived
  // the filter earlier and added clutter ("Missed due to constraints",
  // "Rescheduled to tomorrow as requested", etc.). The user can audit
  // past sessions in the Workouts list / Analytics; here they only want
  // today + future.
  //
  // Cutoff is start-of-today in Asia/Jerusalem so a session scheduled for
  // 06:00 today still shows after lunch — only YESTERDAY and earlier are
  // dropped.
  const tz = "Asia/Jerusalem";
  const todayKeyIL = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  sessions = sessions.filter((s) => {
    const sessionKeyIL = s.date.toLocaleDateString("en-CA", { timeZone: tz });
    return sessionKeyIL >= todayKeyIL;
  });

  // Sort chronologically (synthetic today card may have landed mid-array).
  sessions.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    sessions,
    weekIndex,
    totalWeeks,
  };
}


function formatBlockLabel(block: SessionBlock): string {
  switch (block.kind) {
    case "run_block":
      return "Run Intervals";
    case "warmup":
      return "Warm-up";
    case "strength_block":
      return "Strength Work";
    case "mobility":
      return "Mobility";
    case "rest":
      return "Rest Day";
    default:
      return "Training";
  }
}

function formatBlockDetail(block: SessionBlock): string {
  switch (block.kind) {
    case "run_block": {
      const pace = formatPace(block.paceSecPerKm);
      if (block.reps === 1) return `${block.distanceKm}km @ ${pace} /km`;
      return `${block.reps}× ${block.distanceKm}km @ ${pace} /km`;
    }
    case "warmup":
      return `${block.durationMin} min`;
    case "strength_block":
      return block.exercises.map((ex) => `${ex.name} ${ex.sets}×${ex.reps}`).join(" · ");
    case "mobility":
      return block.exercises.join(", ");
    case "rest":
      return "Recovery & mobility focus";
    default:
      return "";
  }
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
