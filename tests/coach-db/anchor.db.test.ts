/**
 * AF-B6 against a real Postgres: session_date is stamped by the 0009 trigger,
 * and reanchorRoadmap() moves surviving rows onto this week's indexes.
 * Gated on TEST_DATABASE_URL (schema from `pnpm db:migrate`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!URL);

d("roadmap session_date and re-anchoring (real Postgres)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let anchor: typeof import("@/lib/roadmap/anchor");
  let o: typeof import("drizzle-orm");
  let userId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    ({ db } = await import("@/lib/db"));
    schema = await import("@/lib/db/schema");
    anchor = await import("@/lib/roadmap/anchor");
    o = await import("drizzle-orm");
    const [u] = await db.insert(schema.users).values({ email: `af-anchor-${Date.now()}@example.test` }).returning();
    userId = u.id;
  });
  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(o.eq(schema.users.id, userId));
  });

  const plan = { title: "Run", rationale: "", blocks: [{ kind: "rest" as const }] };
  async function sunday(): Promise<string> {
    const r = await db.execute(o.sql`SELECT af_week_sunday(now())::text AS s`);
    return (r.rows[0] as { s: string }).s;
  }
  const plus = (iso: string, days: number) => {
    const t = new Date(iso + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  };
  async function row(id: string) {
    const [r] = await db.select().from(schema.trainingRoadmap).where(o.eq(schema.trainingRoadmap.id, id));
    return r;
  }

  it("an insert is stamped with the date its indexes mean this week", async () => {
    const [r] = await db.insert(schema.trainingRoadmap)
      .values({ userId, weekIndex: 1, dayIndex: 3, sessionPlan: plan, status: "pending", source: "manual" })
      .returning();
    expect(r.sessionDate).toBe(plus(await sunday(), 10));
  });

  it("moving a session (indexes only) moves its date", async () => {
    const [r] = await db.insert(schema.trainingRoadmap)
      .values({ userId, weekIndex: 0, dayIndex: 2, sessionPlan: plan, status: "pending", source: "manual" })
      .returning();
    await db.update(schema.trainingRoadmap).set({ weekIndex: 1, dayIndex: 5 }).where(o.eq(schema.trainingRoadmap.id, r.id));
    expect((await row(r.id)).sessionDate).toBe(plus(await sunday(), 12));
  });

  it("a row written two weeks ago is re-anchored to week -2, so readers drop it", async () => {
    const sun = await sunday();
    const [r] = await db.insert(schema.trainingRoadmap)
      .values({ userId, weekIndex: 0, dayIndex: 2, sessionDate: plus(sun, -12), sessionPlan: plan, status: "pending", source: "coach_proposal" })
      .returning();
    // Before: the stale indexes say "this Tuesday" (the bug).
    expect([r.weekIndex, r.dayIndex]).toEqual([0, 2]);
    await anchor.reanchorRoadmap(userId);
    const after = await row(r.id);
    expect([after.weekIndex, after.dayIndex, after.sessionDate]).toEqual([-2, 2, plus(sun, -12)]);
    // Idempotent: a second call changes nothing.
    await anchor.reanchorRoadmap(userId);
    expect(await row(r.id)).toEqual(after);
  });
});
