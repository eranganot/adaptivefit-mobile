/** AF-6 daily coach budget against a real Postgres. Gated on TEST_DATABASE_URL. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { dailyTurnLimit, DEFAULT_DAILY_TURNS } from "@/lib/coach/dailyCap";

describe("dailyTurnLimit", () => {
  it("defaults, overrides, and 0 disables", () => {
    expect(dailyTurnLimit(undefined)).toBe(DEFAULT_DAILY_TURNS);
    expect(dailyTurnLimit("")).toBe(DEFAULT_DAILY_TURNS);
    expect(dailyTurnLimit("abc")).toBe(DEFAULT_DAILY_TURNS);
    expect(dailyTurnLimit("25")).toBe(25);
    expect(dailyTurnLimit("0")).toBe(0);
  });
});

const URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!URL)("daily coach cap (real Postgres)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let cap: typeof import("@/lib/coach/dailyCap");
  let o: typeof import("drizzle-orm");
  let userId = "";
  let threadId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    ({ db } = await import("@/lib/db"));
    schema = await import("@/lib/db/schema");
    cap = await import("@/lib/coach/dailyCap");
    o = await import("drizzle-orm");
    const [u] = await db.insert(schema.users).values({ email: `af-cap-${Date.now()}@example.test` }).returning();
    userId = u.id;
    const [t] = await db.insert(schema.coachThreads).values({ userId }).returning();
    threadId = t.id;
  });
  afterEach(() => { delete process.env.COACH_DAILY_TURN_LIMIT; });
  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(o.eq(schema.users.id, userId));
  });

  async function say(role: "user" | "assistant", at?: Date) {
    await db.insert(schema.coachChatMessages).values({ userId, threadId, role, content: "x", ...(at ? { createdAt: at } : {}) });
  }

  it("counts only today's user messages, across threads, and refuses at the limit", async () => {
    process.env.COACH_DAILY_TURN_LIMIT = "3";
    await say("user", new Date(Date.now() - 3 * 86_400_000)); // three days ago: not today
    await say("user");
    await say("assistant");
    await say("user");
    expect(await cap.turnsToday(userId)).toBe(2);
    expect(await cap.dailyCapRefusal(userId)).toBeNull();
    await say("user");
    expect(await cap.dailyCapRefusal(userId)).toMatch(/today's coach limit \(3 messages\)/);
    process.env.COACH_DAILY_TURN_LIMIT = "0";
    expect(await cap.dailyCapRefusal(userId)).toBeNull();
  });
});
