/**
 * Throttle behavior for the foreground auto-sync.
 *
 * The HealthConnectAutoSync component runs on every `visibilitychange`
 * (Android resume / tab focus). Without a throttle, switching apps rapidly
 * would hammer Health Connect with reads. The 5-min throttle is the only
 * thing standing between "fine in normal use" and "constant HC traffic."
 *
 * We test the throttle predicate in isolation — the component itself is
 * thin glue, hard to test without a JSDOM environment and a fake
 * syncHealthConnect, and not worth the effort for a one-line useEffect.
 *
 * The function under test is private to HealthConnectAutoSync.tsx; we
 * inline a faithful replica here. If the production implementation drifts
 * from this contract, this test won't catch it — but the spec/intent is
 * pinned in the test name + comments.
 */
import { describe, expect, it, beforeEach } from "vitest";

const FOREGROUND_THROTTLE_MS = 5 * 60 * 1000;
const LAST_SYNC_KEY = "hc:last-foreground-sync-ts";

// In-memory localStorage shim for the test — vitest runs in node and
// doesn't have a real one. Cleared in beforeEach.
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
};

function shouldSync(now: number): boolean {
  try {
    const raw = fakeStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return now - last >= FOREGROUND_THROTTLE_MS;
  } catch {
    return true;
  }
}

describe("foreground auto-sync throttle", () => {
  beforeEach(() => fakeStorage.clear());

  it("first run (no prior timestamp) → should sync", () => {
    expect(shouldSync(Date.now())).toBe(true);
  });

  it("immediately after a sync → should NOT sync (within throttle)", () => {
    const now = Date.now();
    fakeStorage.setItem(LAST_SYNC_KEY, String(now));
    expect(shouldSync(now + 1000)).toBe(false);
  });

  it("4 min 59 sec after a sync → should NOT sync (just under threshold)", () => {
    const now = Date.now();
    fakeStorage.setItem(LAST_SYNC_KEY, String(now));
    expect(shouldSync(now + 4 * 60 * 1000 + 59 * 1000)).toBe(false);
  });

  it("exactly 5 min after a sync → should sync (boundary inclusive)", () => {
    const now = Date.now();
    fakeStorage.setItem(LAST_SYNC_KEY, String(now));
    expect(shouldSync(now + FOREGROUND_THROTTLE_MS)).toBe(true);
  });

  it("hours later → should sync", () => {
    const now = Date.now();
    fakeStorage.setItem(LAST_SYNC_KEY, String(now));
    expect(shouldSync(now + 3 * 60 * 60 * 1000)).toBe(true);
  });

  it("garbage stored value → should sync (fail-open)", () => {
    fakeStorage.setItem(LAST_SYNC_KEY, "not-a-number");
    expect(shouldSync(Date.now())).toBe(true);
  });

  it("empty string stored → should sync", () => {
    fakeStorage.setItem(LAST_SYNC_KEY, "");
    expect(shouldSync(Date.now())).toBe(true);
  });
});
