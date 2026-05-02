/**
 * Google Fit API client with transparent refresh-token rotation.
 * All public functions throw on unrecoverable errors (revoked token etc.)
 * so callers can set oauth_tokens.status = 'error'.
 */
import { db } from "@/lib/db";
import { oauthTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────

export interface FitDailyAggregate {
  date: string;         // "YYYY-MM-DD"
  steps: number | null;
  distanceM: number | null;
  activeMinutes: number | null;
  avgHr: number | null;
  calories: number | null;
}

export interface FitSessionSummary {
  fitSessionId: string;
  activityType: number;
  startTimeMs: number;
  endTimeMs: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  steps: number | null;
  calories: number | null;
  route: Array<{ lat: number; lon: number; ts: number }> | null;
}

// ── Internal token management ─────────────────────────────────────

interface TokenRow {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

async function refreshAccessToken(
  userId: string,
  row: TokenRow,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_FIT_CLIENT_ID!,
      client_secret: process.env.GOOGLE_FIT_CLIENT_SECRET!,
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    // Mark token as errored so Settings shows a banner
    await db
      .update(oauthTokens)
      .set({ status: "error", updatedAt: new Date() })
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google_fit")));
    throw new Error(`Token refresh failed: ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await db
    .update(oauthTokens)
    .set({ accessToken: data.access_token, expiresAt, updatedAt: new Date() })
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google_fit")));

  return data.access_token;
}

/** Returns a valid access token, refreshing if expired. */
async function getAccessToken(userId: string): Promise<string> {
  const row = await db.query.oauthTokens.findFirst({
    where: (t, { and }) => and(eq(t.userId, userId), eq(t.provider, "google_fit")),
  });

  if (!row || row.status === "revoked") {
    throw new Error("Google Fit not connected");
  }

  // Refresh if expiring within 60 seconds
  if (row.expiresAt.getTime() - Date.now() < 60_000) {
    return refreshAccessToken(userId, row);
  }

  return row.accessToken;
}

/** Low-level authenticated fetch to the Fit REST API. */
async function fitFetch(userId: string, path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken(userId);
  return fetch(`https://www.googleapis.com/fitness/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Pull daily aggregate metrics for a date range.
 * Uses the users.dataset:aggregate endpoint.
 */
export async function aggregateDaily(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<FitDailyAggregate[]> {
  const startMs = startDate.setHours(0, 0, 0, 0);
  const endMs = new Date(endDate).setHours(23, 59, 59, 999);

  const body = {
    aggregateBy: [
      { dataTypeName: "com.google.step_count.delta" },
      { dataTypeName: "com.google.distance.delta" },
      { dataTypeName: "com.google.heart_rate.bpm" },
      { dataTypeName: "com.google.active_minutes" },
      { dataTypeName: "com.google.calories.expended" },
    ],
    bucketByTime: { durationMillis: 86_400_000 }, // 1 day
    startTimeMillis: startMs,
    endTimeMillis: endMs,
  };

  const res = await fitFetch(userId, "/users/me/dataset:aggregate", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Fit aggregate failed: ${await res.text()}`);

  const json = await res.json() as { bucket: FitBucket[] };
  return json.bucket.map(parseBucket);
}

interface FitBucket {
  startTimeMillis: string;
  dataset: Array<{
    dataSourceId: string;
    point: Array<{
      value: Array<{ intVal?: number; fpVal?: number }>;
    }>;
  }>;
}

function parseBucket(bucket: FitBucket): FitDailyAggregate {
  const date = new Date(parseInt(bucket.startTimeMillis));
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");

  let steps: number | null = null;
  let distanceM: number | null = null;
  let activeMinutes: number | null = null;
  let avgHr: number | null = null;
  let calories: number | null = null;

  for (const ds of bucket.dataset) {
    const point = ds.point[0];
    if (!point) continue;
    const v = point.value[0];
    if (!v) continue;

    if (ds.dataSourceId.includes("step_count")) steps = v.intVal ?? null;
    else if (ds.dataSourceId.includes("distance")) distanceM = Math.round((v.fpVal ?? 0));
    else if (ds.dataSourceId.includes("active_minutes")) activeMinutes = v.intVal ?? null;
    else if (ds.dataSourceId.includes("heart_rate")) avgHr = Math.round(v.fpVal ?? 0) || null;
    else if (ds.dataSourceId.includes("calories")) calories = Math.round(v.fpVal ?? 0) || null;
  }

  return { date: `${yyyy}-${mm}-${dd}`, steps, distanceM, activeMinutes, avgHr, calories };
}

/**
 * List workout sessions in a date range.
 */
export async function listSessions(
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<FitSessionSummary[]> {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  const res = await fitFetch(
    userId,
    `/users/me/sessions?startTime=${new Date(startMs).toISOString()}&endTime=${new Date(endMs).toISOString()}&activityType=8`, // 8 = running
  );

  if (!res.ok) throw new Error(`Fit sessions failed: ${await res.text()}`);
  const json = await res.json() as { session?: FitRawSession[] };
  const sessions = json.session ?? [];

  return sessions.map((s) => ({
    fitSessionId: s.id,
    activityType: s.activityType,
    startTimeMs: parseInt(s.startTimeMillis),
    endTimeMs: parseInt(s.endTimeMillis),
    distanceM: null,
    avgHr: null,
    maxHr: null,
    steps: null,
    calories: null,
    route: null,
  }));
}

interface FitRawSession {
  id: string;
  activityType: number;
  startTimeMillis: string;
  endTimeMillis: string;
}

/**
 * Mark the token's lastSyncAt timestamp.
 */
export async function markLastSync(userId: string): Promise<void> {
  await db
    .update(oauthTokens)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, "google_fit")));
}
