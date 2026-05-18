"use client";

/**
 * Crash-safe run persistence.
 *
 * The active run is stored in IndexedDB so it survives:
 *   - Page reload / SPA navigation
 *   - Browser tab close / app kill (state restored on next open)
 *   - Service worker restarts
 *   - JS errors that unmount the React tree
 *
 * Schema:
 *   db: "adaptivefit"        version 1
 *   store: "activeRun"       keyPath: "id" (we only ever store one row, id = "current")
 *
 * The store holds a single snapshot per active run. Points are appended to the
 * snapshot's `points` array on every accepted GPS sample. We avoid a separate
 * points store (with a per-point row) to keep writes cheap on slow Android
 * IndexedDB implementations — a single `put` per second is well within budget.
 *
 * If IndexedDB is unavailable (private browsing, OS limits) we fall back to a
 * synchronous localStorage mirror so resume still works for short runs. For a
 * long run this would blow the 5 MB localStorage quota, so the fallback caps
 * the route at ~5000 points and drops oldest beyond that — the server-side
 * 15s upload (Phase 2) is the durable source of truth in that case anyway.
 */

import type { GpsRawPoint } from "./haversine";

const DB_NAME = "adaptivefit";
const DB_VERSION = 1;
const STORE = "activeRun";
const SINGLETON_ID = "current";
const LS_KEY = "adaptivefit:activeRun";
const LS_MAX_POINTS = 5000;

export type ActiveRunStatus = "running" | "paused";

export type ActiveRunSnapshot = {
  id: typeof SINGLETON_ID;
  clientRunId: string;         // stable UUID for the whole run, used for server idempotency
  status: ActiveRunStatus;
  startedAt: number;           // unix ms
  pausedAt: number | null;     // unix ms — used to keep duration correct across resume
  distanceKm: number;
  durationSec: number;
  points: GpsRawPoint[];
  lastUploadedIdx: number;     // index up to which points have been flushed to server
  updatedAt: number;           // unix ms
};

// ─────────────────────────────────────────────────────────────────
// IndexedDB low-level helpers
// ─────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("IndexedDB open failed"));
    };
    req.onblocked = () => {
      // Another tab has the DB open at a lower version. Shouldn't happen in
      // practice (we ship a single version), but log and let the promise
      // hang until the other tab closes.
      console.warn("[adaptivefit:persistence] IndexedDB upgrade blocked");
    };
  });
  return dbPromise;
}

async function idbGet(): Promise<ActiveRunSnapshot | null> {
  try {
    const db = await openDb();
    return await new Promise<ActiveRunSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(SINGLETON_ID);
      req.onsuccess = () => resolve((req.result as ActiveRunSnapshot | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return lsGet();
  }
}

async function idbPut(snap: ActiveRunSnapshot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snap);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    lsMirror(snap);
  } catch {
    lsMirror(snap);
  }
}

async function idbDelete(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(SINGLETON_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* fall through to LS clear */
  }
  lsClear();
}

// ─────────────────────────────────────────────────────────────────
// localStorage mirror (fallback for IDB failures, and for synchronous reads
// during early page render before IDB has resolved)
// ─────────────────────────────────────────────────────────────────

function lsMirror(snap: ActiveRunSnapshot): void {
  if (typeof localStorage === "undefined") return;
  try {
    const capped: ActiveRunSnapshot =
      snap.points.length > LS_MAX_POINTS
        ? { ...snap, points: snap.points.slice(-LS_MAX_POINTS) }
        : snap;
    localStorage.setItem(LS_KEY, JSON.stringify(capped));
  } catch {
    /* quota exceeded — give up on the mirror, IDB is still authoritative */
  }
}

function lsGet(): ActiveRunSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveRunSnapshot;
  } catch {
    return null;
  }
}

function lsClear(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/** Cryptographically strong UUID, with a fallback for older browsers. */
export function newClientRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122 v4-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getActiveRun(): Promise<ActiveRunSnapshot | null> {
  return idbGet();
}

/** Synchronous LS-only read for use during SSR/initial render. May be stale. */
export function getActiveRunSync(): ActiveRunSnapshot | null {
  return lsGet();
}

export async function saveActiveRun(snap: Omit<ActiveRunSnapshot, "id" | "updatedAt">): Promise<void> {
  const full: ActiveRunSnapshot = { ...snap, id: SINGLETON_ID, updatedAt: Date.now() };
  await idbPut(full);
}

export async function clearActiveRun(): Promise<void> {
  await idbDelete();
}

/**
 * Returns true if the snapshot is stale enough that we should not auto-resume.
 * Default threshold: 24 hours since `updatedAt`.
 */
export function isStaleRun(snap: ActiveRunSnapshot, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  return Date.now() - snap.updatedAt > maxAgeMs;
}
