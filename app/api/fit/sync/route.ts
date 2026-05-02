/**
 * POST /api/fit/sync
 * Pulls the last 30 days of Google Fit data and upserts into the DB.
 * Called by:
 *   - OAuth callback (first connect, coldStart=true)
 *   - Settings "Sync now" button
 *   - Nightly Railway cron (x-internal-secret header required)
 *
 * Body: { userId?: string, coldStart?: boolean }
 * - When userId is provided (cron path) it syncs that user.
 * - When omitted, the caller's session userId is used.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, fitDailyMetrics, fitSessions, oauthTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { aggregateDaily, listSessions, markLastSync } from "@/lib/fit/client";
import { runColdStart } from "@/lib/coach/coldStart";

export async function POST(req: NextRequest) {
  // Auth: either a logged-in session or a valid cron secret
  const cronSecret = process.env.CRON_SECRET;
  const internalSecret = req.headers.get("x-internal-secret");
  const isCron = cronSecret && internalSecret === cronSecret;

  let targetUserId: string | null = null;

  if (isCron) {
    const body = await req.json().catch(() => ({})) as { userId?: string; coldStart?: boolean };
    targetUserId = body.userId ?? null;
  } else {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    targetUserId = user.id;
  }

  if (!targetUserId) {
    return NextResponse.json({ error: "No userId" }, { status: 400 });
  }

  // Parse coldStart flag
  const body = isCron
    ? await req.json().catch(() => ({})) as { coldStart?: boolean }
    : {};
  const coldStart = (body as { coldStart?: boolean }).coldStart ?? false;

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    // ── Pull daily aggregates ──────────────────────────────────────
    const dailyData = await aggregateDaily(targetUserId, startDate, endDate);

    for (const day of dailyData) {
      if (!day.steps && !day.distanceM && !day.activeMinutes) continue; // skip empty days

      await db
        .insert(fitDailyMetrics)
        .values({
          userId: targetUserId,
          date: day.date,
          steps: day.steps,
          distanceM: day.distanceM,
          activeMinutes: day.activeMinutes,
          avgHr: day.avgHr,
          calories: day.calories,
        })
        .onConflictDoUpdate({
          target: [fitDailyMetrics.userId, fitDailyMetrics.date],
          set: {
            steps: day.steps,
            distanceM: day.distanceM,
            activeMinutes: day.activeMinutes,
            avgHr: day.avgHr,
            calories: day.calories,
            updatedAt: new Date(),
          },
        });
    }

    // ── Pull sessions ─────────────────────────────────────────────
    const sessions = await listSessions(targetUserId, startDate, endDate);

    for (const s of sessions) {
      await db
        .insert(fitSessions)
        .values({
          userId: targetUserId,
          fitSessionId: s.fitSessionId,
          activityType: s.activityType,
          startTime: new Date(s.startTimeMs),
          endTime: new Date(s.endTimeMs),
          distanceM: s.distanceM,
          avgHr: s.avgHr,
          maxHr: s.maxHr,
          steps: s.steps,
          calories: s.calories,
          route: s.route,
        })
        .onConflictDoUpdate({
          target: [fitSessions.userId, fitSessions.fitSessionId],
          set: {
            distanceM: s.distanceM,
            avgHr: s.avgHr,
            maxHr: s.maxHr,
            steps: s.steps,
            calories: s.calories,
          },
        });
    }

    // ── Mark last sync timestamp ──────────────────────────────────
    await markLastSync(targetUserId);

    // ── Cold-start analysis (first connect only) ──────────────────
    if (coldStart) {
      await runColdStart(targetUserId).catch((e) =>
        console.error("Cold-start non-fatal:", e),
      );
    }

    return NextResponse.json({
      success: true,
      daysFetched: dailyData.length,
      sessionsFetched: sessions.length,
    });
  } catch (err) {
    console.error("Fit sync error:", err);
    // Mark token as errored so Settings shows a banner
    await db
      .update(oauthTokens)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(oauthTokens.userId, targetUserId))
      .catch(() => {});

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/fit/sync — nightly cron: sync ALL users with active Fit tokens.
 * Railway cron hits this with the CRON_SECRET header.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const activeTokens = await db.query.oauthTokens.findMany({
    where: (t, { and, eq }) => and(eq(t.provider, "google_fit"), eq(t.status, "active")),
  });

  const results: Array<{ userId: string; ok: boolean; error?: string }> = [];

  for (const token of activeTokens) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const dailyData = await aggregateDaily(token.userId, startDate, endDate);
      for (const day of dailyData) {
        if (!day.steps && !day.distanceM && !day.activeMinutes) continue;
        await db
          .insert(fitDailyMetrics)
          .values({ userId: token.userId, date: day.date, ...day })
          .onConflictDoUpdate({
            target: [fitDailyMetrics.userId, fitDailyMetrics.date],
            set: { ...day, updatedAt: new Date() },
          });
      }

      await markLastSync(token.userId);
      results.push({ userId: token.userId, ok: true });
    } catch (e) {
      results.push({ userId: token.userId, ok: false, error: String(e) });
    }
  }

  return NextResponse.json({ synced: results.length, results });
}
