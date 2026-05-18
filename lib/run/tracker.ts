"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  haversineKm,
  isPointValid,
  windowedPace,
  type GpsRawPoint,
} from "./haversine";
import {
  type ActiveRunSnapshot,
  clearActiveRun,
  getActiveRun,
  isStaleRun,
  newClientRunId,
  saveActiveRun,
} from "./persistence";
import { watchPosition, type GeoWatcher } from "./nativeGeolocation";
import { appendRunPoints } from "@/app/(app)/home/runActions";

export type RunStatus = "idle" | "acquiring" | "running" | "paused" | "ended";

export type RunTrackerState = {
  status: RunStatus;
  startedAt: Date | null;
  distanceKm: number;
  paceSecPerKm: number | null;  // null until enough data
  secondsElapsed: number;
  currentPosition: { lat: number; lon: number } | null;
  route: GpsRawPoint[];
  error: string | null;
};

export type RunEndPayload = {
  startedAt: Date;
  endedAt: Date;
  points: GpsRawPoint[];
  distanceKm: number;
  durationSec: number;
  clientRunId: string;
};

export type RunTrackerActions = {
  start: () => void;
  /** Rehydrate from IndexedDB; resolves to true if a run was restored. */
  restore: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  end: () => RunEndPayload | null;
  /** True iff a non-stale active run exists in persistence (call before start/restore). */
  hasPersistedRun: () => Promise<ActiveRunSnapshot | null>;
};

const INITIAL_STATE: RunTrackerState = {
  status: "idle",
  startedAt: null,
  distanceKm: 0,
  paceSecPerKm: null,
  secondsElapsed: 0,
  currentPosition: null,
  route: [],
  error: null,
};

// How often we flush buffered points to the server while running. The user
// chose 15 seconds in the planning phase — a sensible trade-off between data
// safety in a crash and battery / bandwidth.
const SERVER_FLUSH_INTERVAL_MS = 15_000;
// How often we snapshot the full active run to IndexedDB (separate from per-
// point appends, which happen on every GPS callback). 2s captures duration
// ticks without flooding IDB.
const PERSIST_INTERVAL_MS = 2_000;

export function useRunTracker(): RunTrackerState & RunTrackerActions {
  const [state, setState] = useState<RunTrackerState>(INITIAL_STATE);

  // Refs that survive re-renders without triggering them
  const watcherRef = useRef<GeoWatcher | null>(null);
  /** Set true between startWatcher() and stopWatcher(); used to abort
   *  the in-flight watchPosition() Promise if stop is called early. */
  const shouldWatchRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAcceptedRef = useRef<GpsRawPoint | null>(null);
  const isPausedRef = useRef(false);
  const startedAtRef = useRef<Date | null>(null);
  const clientRunIdRef = useRef<string | null>(null);

  // Mirror the live values into refs so end() can read them synchronously.
  // React 18+ batches state updates, so reading state right after setState()
  // returns stale values — we'd lose the user's distance/route/duration on Stop.
  const routeRef = useRef<GpsRawPoint[]>([]);
  const distanceKmRef = useRef(0);
  const secondsElapsedRef = useRef(0);
  const lastUploadedIdxRef = useRef(0);
  const flushInFlightRef = useRef(false);

  // ── Persistence ────────────────────────────────────────────────
  const persistSnapshot = useCallback(async (status: "running" | "paused") => {
    if (!clientRunIdRef.current || !startedAtRef.current) return;
    try {
      await saveActiveRun({
        clientRunId: clientRunIdRef.current,
        status,
        startedAt: startedAtRef.current.getTime(),
        pausedAt: status === "paused" ? Date.now() : null,
        distanceKm: distanceKmRef.current,
        durationSec: secondsElapsedRef.current,
        points: routeRef.current,
        lastUploadedIdx: lastUploadedIdxRef.current,
      });
    } catch (e) {
      // Persistence is best-effort. Real failure mode is "no resume on next
      // open", not data loss (server flush is the durable path).
      console.warn("[tracker] persist failed:", e);
    }
  }, []);

  // ── Server flush ───────────────────────────────────────────────
  const flushToServer = useCallback(async () => {
    if (flushInFlightRef.current) return;
    if (!clientRunIdRef.current || !startedAtRef.current) return;
    const drainTo = routeRef.current.length;
    if (drainTo === lastUploadedIdxRef.current) {
      // Nothing new to send, but still upsert the row so the server knows the
      // run exists (covers "user started run, no GPS lock yet, app crashes").
      if (lastUploadedIdxRef.current === 0 && routeRef.current.length === 0) {
        flushInFlightRef.current = true;
        try {
          await appendRunPoints({
            clientRunId: clientRunIdRef.current,
            startedAt: startedAtRef.current,
            distanceKm: distanceKmRef.current,
            durationSec: secondsElapsedRef.current,
            newPoints: [],
          });
        } catch (e) {
          console.warn("[tracker] flush (heartbeat) failed:", e);
        } finally {
          flushInFlightRef.current = false;
        }
      }
      return;
    }

    const newPoints = routeRef.current.slice(lastUploadedIdxRef.current, drainTo);
    flushInFlightRef.current = true;
    try {
      const res = await appendRunPoints({
        clientRunId: clientRunIdRef.current,
        startedAt: startedAtRef.current,
        distanceKm: distanceKmRef.current,
        durationSec: secondsElapsedRef.current,
        newPoints,
      });
      if (res.success) {
        lastUploadedIdxRef.current = drainTo;
        // Persist the new high-water mark so we don't re-upload on resume.
        void persistSnapshot(isPausedRef.current ? "paused" : "running");
      } else {
        console.warn("[tracker] flush rejected:", res.error);
      }
    } catch (e) {
      // Network/server error — we'll retry on the next interval. IDB still
      // holds everything.
      console.warn("[tracker] flush failed:", e);
    } finally {
      flushInFlightRef.current = false;
    }
  }, [persistSnapshot]);

  // ── GPS watcher ────────────────────────────────────────────────
  // Uses lib/run/nativeGeolocation.ts which transparently picks the right
  // implementation: native foreground-service plugin on Android (keeps GPS
  // alive when screen locks / app is backgrounded / app is killed) or the
  // browser navigator.geolocation.watchPosition on web.
  const startWatcher = useCallback(() => {
    shouldWatchRef.current = true;

    void watchPosition(
      (point) => {
        if (!shouldWatchRef.current) return;
        if (!isPointValid(point, lastAcceptedRef.current)) return;
        if (isPausedRef.current) return; // don't accumulate while paused

        const prev = lastAcceptedRef.current;
        const segKm = prev ? haversineKm(prev.lat, prev.lon, point.lat, point.lon) : 0;
        lastAcceptedRef.current = point;

        // Update refs synchronously so end() always sees the latest values.
        routeRef.current = [...routeRef.current, point];
        distanceKmRef.current = distanceKmRef.current + segKm;
        const pace = windowedPace(routeRef.current);

        // Update React state for the UI.
        setState((s) => ({
          ...s,
          status: "running",
          distanceKm: distanceKmRef.current,
          paceSecPerKm: pace,
          currentPosition: { lat: point.lat, lon: point.lon },
          route: routeRef.current,
        }));
      },
      (err) => {
        if (!shouldWatchRef.current) return;
        // permission_denied is the most actionable case — the UI shows a
        // banner directing the user to grant location in Settings. Other
        // errors are non-fatal; the watcher keeps trying.
        const friendly =
          err.code === "permission_denied"
            ? "Location permission denied. Enable it in Settings to track your run."
            : err.code === "not_supported"
              ? "Geolocation not supported on this device."
              : `GPS error: ${err.message}`;
        setState((s) => ({ ...s, error: friendly }));
      },
      {
        backgroundTitle: "AdaptiveFit",
        backgroundMessage: "Tracking your run — tap to return",
      },
    ).then((watcher) => {
      if (!shouldWatchRef.current) {
        // stopWatcher was called before the native plugin finished its
        // async setup — stop the just-started watcher immediately.
        void watcher.stop();
        return;
      }
      watcherRef.current = watcher;
    });
  }, []);

  const stopWatcher = useCallback(async () => {
    shouldWatchRef.current = false;
    const w = watcherRef.current;
    watcherRef.current = null;
    if (w) {
      try {
        await w.stop();
      } catch (e) {
        console.warn("[tracker] stopWatcher:", e);
      }
    }
  }, []);

  // ── Timer ──────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      if (!isPausedRef.current) {
        secondsElapsedRef.current = secondsElapsedRef.current + 1;
        setState((s) => ({ ...s, secondsElapsed: secondsElapsedRef.current }));
      }
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ── Background intervals (persist + server flush) ─────────────
  const startBackgroundLoops = useCallback(() => {
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    persistTimerRef.current = setInterval(() => {
      void persistSnapshot(isPausedRef.current ? "paused" : "running");
    }, PERSIST_INTERVAL_MS);

    if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    flushTimerRef.current = setInterval(() => {
      void flushToServer();
    }, SERVER_FLUSH_INTERVAL_MS);
  }, [persistSnapshot, flushToServer]);

  const stopBackgroundLoops = useCallback(() => {
    if (persistTimerRef.current) {
      clearInterval(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  // ── Public actions ─────────────────────────────────────────────
  const start = useCallback(() => {
    const now = new Date();
    startedAtRef.current = now;
    clientRunIdRef.current = newClientRunId();
    isPausedRef.current = false;
    // Reset live-value refs for a fresh run
    routeRef.current = [];
    distanceKmRef.current = 0;
    secondsElapsedRef.current = 0;
    lastAcceptedRef.current = null;
    lastUploadedIdxRef.current = 0;
    setState({ ...INITIAL_STATE, status: "acquiring", startedAt: now });
    startWatcher();
    startTimer();
    startBackgroundLoops();
    // Immediate first persist so a crash 1s after Start still leaves a resumable row.
    void persistSnapshot("running");
    // Immediate server heartbeat too — claims the clientRunId server-side.
    void flushToServer();
  }, [startWatcher, startTimer, startBackgroundLoops, persistSnapshot, flushToServer]);

  const restore = useCallback(async (): Promise<boolean> => {
    const snap = await getActiveRun();
    if (!snap) return false;
    if (isStaleRun(snap)) {
      await clearActiveRun();
      return false;
    }

    startedAtRef.current = new Date(snap.startedAt);
    clientRunIdRef.current = snap.clientRunId;
    routeRef.current = snap.points;
    distanceKmRef.current = snap.distanceKm;
    secondsElapsedRef.current = snap.durationSec;
    lastAcceptedRef.current = snap.points.length > 0 ? snap.points[snap.points.length - 1] : null;
    lastUploadedIdxRef.current = Math.min(snap.lastUploadedIdx, snap.points.length);
    isPausedRef.current = snap.status === "paused";

    setState({
      status: snap.status,
      startedAt: new Date(snap.startedAt),
      distanceKm: snap.distanceKm,
      paceSecPerKm: windowedPace(snap.points),
      secondsElapsed: snap.durationSec,
      currentPosition:
        snap.points.length > 0
          ? {
              lat: snap.points[snap.points.length - 1].lat,
              lon: snap.points[snap.points.length - 1].lon,
            }
          : null,
      route: snap.points,
      error: null,
    });

    startWatcher();
    startTimer();
    startBackgroundLoops();
    // Flush any points the previous session never managed to upload.
    void flushToServer();
    return true;
  }, [startWatcher, startTimer, startBackgroundLoops, flushToServer]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    setState((s) => ({ ...s, status: "paused" }));
    void persistSnapshot("paused");
    // Keep GPS watcher alive so we know position when resumed
  }, [persistSnapshot]);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    // Reset lastAccepted so we don't accumulate the "jump" from paused GPS drift
    lastAcceptedRef.current = null;
    setState((s) => ({ ...s, status: "running" }));
    void persistSnapshot("running");
  }, [persistSnapshot]);

  const end = useCallback((): RunEndPayload | null => {
    // stopWatcher is async (native plugin needs await) but we fire-and-forget
    // here because the return value of end() must be sync. The watcher will
    // be stopped (and foreground-service notification dismissed) shortly.
    void stopWatcher();
    stopTimer();
    stopBackgroundLoops();
    isPausedRef.current = false;

    const endedAt = new Date();
    const startedAt = startedAtRef.current;
    const clientRunId = clientRunIdRef.current;
    if (!startedAt || !clientRunId) return null;

    // Mark UI state as ended (async — but we don't depend on it for the return value).
    setState((s) => ({ ...s, status: "ended" }));

    // Persistence is cleared by HomeClient after endRunSession succeeds so we
    // don't accidentally lose data if the final server call fails. (See
    // handleRunEnd in HomeClient.tsx.)

    // Read from refs — these are guaranteed to be the latest values regardless
    // of React's batching behavior.
    return {
      startedAt,
      endedAt,
      points: routeRef.current,
      distanceKm: distanceKmRef.current,
      durationSec: secondsElapsedRef.current,
      clientRunId,
    };
  }, [stopWatcher, stopTimer, stopBackgroundLoops]);

  const hasPersistedRun = useCallback(async () => {
    const snap = await getActiveRun();
    if (!snap) return null;
    if (isStaleRun(snap)) {
      await clearActiveRun();
      return null;
    }
    return snap;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopWatcher();
      stopTimer();
      stopBackgroundLoops();
    };
  }, [stopWatcher, stopTimer, stopBackgroundLoops]);

  return { ...state, start, restore, pause, resume, end, hasPersistedRun };
}

/** Helper for one-off "is there a run in progress?" queries from outside the hook. */
export { getActiveRun as peekPersistedRun, clearActiveRun as discardPersistedRun };
