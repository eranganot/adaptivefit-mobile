/**
 * AF-B4 / AF-B5 against a real Postgres (row locks cannot be faked).
 * Runs only when TEST_DATABASE_URL is set; the schema must already exist
 * (drizzle-kit push, then pnpm db:migrate). CI sets this up in .github/workflows/ci.yml.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.TEST_DATABASE_URL;
const d = describe.skipIf(!URL);

d("coach chat actions: transactional apply / revert (real Postgres)", () => {
  // Imported lazily so lib/db reads DATABASE_URL = TEST_DATABASE_URL.
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let tx: typeof import("@/lib/coach/chatActionTx");
  let drizzle: typeof import("drizzle-orm");
  let userId = "";
  let messageId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    ({ db } = await import("@/lib/db"));
    schema = await import("@/lib/db/schema");
    tx = await import("@/lib/coach/chatActionTx");
    drizzle = await import("drizzle-orm");
    const [u] = await db.insert(schema.users).values({ email: `af-test-${Date.now()}@example.test` }).returning();
    userId = u.id;
    const [t] = await db.insert(schema.coachThreads).values({ userId }).returning();
    const [m] = await db
      .insert(schema.coachChatMessages)
      .values({ userId, threadId: t.id, role: "assistant", content: "proposal" })
      .returning();
    messageId = m.id;
  });

  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(drizzle.eq(schema.users.id, userId));
  });

  async function session(status: "pending" | "completed" = "pending") {
    const [r] = await db
      .insert(schema.trainingRoadmap)
      .values({
        userId,
        goalId: null,
        weekIndex: 1,
        dayIndex: 2,
        status,
        source: "auto",
        sessionPlan: { title: "Easy 5k", rationale: "", blocks: [{ kind: "run_block", distanceKm: 5, paceSecPerKm: 400, reps: 1, recoverySec: 0 }] },
      })
      .returning();
    return r;
  }

  async function action(actionType: "add_session" | "replace_session" | "swap_to_rest", params: Record<string, unknown>) {
    const [a] = await db
      .insert(schema.coachChatActions)
      .values({ chatMessageId: messageId, userId, actionType, params, reason: "test" })
      .returning();
    return a;
  }

  it("a double-tap on Approve applies once: one success, one 'already approved', one new session", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const a = await action("add_session", { targetDate: tomorrow, title: "Coach 6k", distanceKm: 6 });
    const results = await Promise.all([
      db.transaction((t) => tx.applyIn(t, a.id, userId)),
      db.transaction((t) => tx.applyIn(t, a.id, userId)),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.find((r) => !r.success)).toMatchObject({ success: false, error: "Action already approved" });
    const created = await db
      .select()
      .from(schema.trainingRoadmap)
      .where(drizzle.and(drizzle.eq(schema.trainingRoadmap.userId, userId), drizzle.eq(schema.trainingRoadmap.source, "coach_proposal")));
    expect(created).toHaveLength(1);
  });

  it("a double-tap on Undo reverts once", async () => {
    const s = await session();
    const a = await action("swap_to_rest", { sessionId: s.id });
    expect(await db.transaction((t) => tx.applyIn(t, a.id, userId))).toEqual({ success: true });
    const results = await Promise.all([
      db.transaction((t) => tx.revertIn(t, a.id, userId)),
      db.transaction((t) => tx.revertIn(t, a.id, userId)),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const [back] = await db.select().from(schema.trainingRoadmap).where(drizzle.eq(schema.trainingRoadmap.id, s.id));
    expect((back.sessionPlan as { title: string }).title).toBe("Easy 5k");
  });

  it("the coach cannot rewrite a completed session (AF-B5)", async () => {
    const s = await session("completed");
    const a = await action("replace_session", { sessionId: s.id, distanceKm: 10 });
    const r = await db.transaction((t) => tx.applyIn(t, a.id, userId));
    expect(r).toEqual({ success: false, error: "That session is already completed" });
    const [still] = await db.select().from(schema.trainingRoadmap).where(drizzle.eq(schema.trainingRoadmap.id, s.id));
    expect((still.sessionPlan as { title: string }).title).toBe("Easy 5k");
    const [act] = await db.select().from(schema.coachChatActions).where(drizzle.eq(schema.coachChatActions.id, a.id));
    expect(act.status).toBe("pending");
  });
});
