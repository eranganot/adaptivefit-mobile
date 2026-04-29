import { db } from "@/lib/db";
import { trainingRoadmap, workoutLogs, goals } from "@/lib/db/schema";
import { eq, and, gte, desc, lte } from "drizzle-orm";
import { evaluateCoach } from "@/lib/coach";
import type { SessionPlan, SessionBlock, CoachInputs } from "@/lib/coach";

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

  // 4. If no roadmap exists, seed it
  if (roadmapRows.length === 0) {
    await seedRoadmap(userId, activeGoal?.id ?? null);
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
  const sessions: RoadmapSession[] = roadmapRows.map((row) => {
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

    if (row.status === "modified") {
      status = "adjusted";
      adjustedNote = plan.rationale || "Session was adjusted";
    } else if (row.status === "completed" || logOnDay) {
      status = "completed";
    }

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
    };
  });

  return {
    sessions,
    weekIndex,
    totalWeeks,
  };
}

async function seedRoadmap(userId: string, goalId: string | null): Promise<void> {
  // Get recent logs and current state for coach evaluation
  const last14Days = new Date();
  last14Days.setDate(last14Days.getDate() - 14);

  const recentLogs = await db
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, userId), gte(workoutLogs.performedAt, last14Days)))
    .orderBy(desc(workoutLogs.performedAt))
    .limit(20);

  const userState: CoachInputs["state"] = {
    currentLevel: 1,
    greenSessionCount: 0,
    freezeActive: false,
    freezeReason: null,
  };

  // Generate 2 weeks of sessions: days 1 and 4 (Tue/Fri pattern)
  const sessionsToCreate = [];

  for (let weekIdx = 0; weekIdx < 2; weekIdx++) {
    // Tuesday (day 1)
    const tuePlan = evaluateCoach({
      recentLogs,
      state: userState,
      today: new Date(),
    }).todayPlan;

    sessionsToCreate.push({
      userId,
      goalId,
      weekIndex: weekIdx,
      dayIndex: 1, // Tuesday
      sessionPlan: tuePlan,
      status: "pending" as const,
      createdAt: new Date(),
    });

    // Friday (day 4)
    const friPlan = evaluateCoach({
      recentLogs,
      state: userState,
      today: new Date(),
    }).todayPlan;

    sessionsToCreate.push({
      userId,
      goalId,
      weekIndex: weekIdx,
      dayIndex: 4, // Friday
      sessionPlan: friPlan,
      status: "pending" as const,
      createdAt: new Date(),
    });
  }

  if (sessionsToCreate.length > 0) {
    await db.insert(trainingRoadmap).values(sessionsToCreate);
  }
}

function formatBlockLabel(block: SessionBlock): string {
  switch (block.kind) {
    case "run_block":
      return "Run Intervals";
    case "warmup":
      return "Warm-up";
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
    case "run_block":
      const pace = formatPace(block.paceSecPerKm);
      if (block.reps === 1) {
        return `${block.distanceKm}km @ ${pace} /km`;
      }
      return `${block.reps}× ${block.distanceKm}km @ ${pace} /km`;
    case "warmup":
      return `${block.durationMin} min`;
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
