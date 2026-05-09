"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  haversineKm,
  isPointValid,
  windowedPace,
  type GpsRawPoint,
} from "./haversine";

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

export type RunTrackerActions = {
  start: () => void;
  pause: () => void;
  resume: () => void;
  end: () => { startedAt: Date; endedAt: Date; points: GpsRawPoint[]; distanceKm: number; durationSec: number } | null;
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

export function useRunTracker(): RunTrackerState & RunTrackerActions {
  const [state, setState] = useState<RunTrackerState>(INITIAL_STATE);

  // Refs that survive re-renders without triggering them
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAcceptedRef = useRef<GpsRawPoint | null>(null);
  const isPausedRef = useRef(false);
  const startedAtRef = useRef<Date | null>(null);

  // Mirror the live values into refs so end() can read them synchronously.
  // React 18+ batches state updates, so reading state right after setState()
  // returns stale values — we'd lose the user's distance/route/duration on Stop.
  const routeRef = useRef<GpsRawPoint[]>([]);
  const distanceKmRef = useRef(0);
  const secondsElapsedRef = useRef(0);

  // ── GPS watcher ────────────────────────────────────────────────
  const startWatcher = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: "Geolocation not supported on this device." }));
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point: GpsRawPoint = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          ts: pos.timestamp,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude ?? undefined,
        };

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
        setState((s) => ({ ...s, error: `GPS error: ${err.message}` }));
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }, []);

  const stopWatcher = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
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

  // ── Public actions ─────────────────────────────────────────────
  const start = useCallback(() => {
    const now = new Date();
    startedAtRef.current = now;
    isPausedRef.current = false;
    // Reset live-value refs for a fresh run
    routeRef.current = [];
    distanceKmRef.current = 0;
    secondsElapsedRef.current = 0;
    lastAcceptedRef.current = null;
    setState({ ...INITIAL_STATE, status: "acquiring", startedAt: now });
    startWatcher();
    startTimer();
  }, [startWatcher, startTimer]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    setState((s) => ({ ...s, status: "paused" }));
    // Keep GPS watcher alive so we know position when resumed
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    // Reset lastAccepted so we don't accumulate the "jump" from paused GPS drift
    lastAcceptedRef.current = null;
    setState((s) => ({ ...s, status: "running" }));
  }, []);

  const end = useCallback((): ReturnType<RunTrackerActions["end"]> => {
    stopWatcher();
    stopTimer();
    isPausedRef.current = false;

    const endedAt = new Date();
    const startedAt = startedAtRef.current;
    if (!startedAt) return null;

    // Mark UI state as ended (async — but we don't depend on it for the return value).
    setState((s) => ({ ...s, status: "ended" }));

    // Read from refs — these are guaranteed to be the latest values regardless
    // of React's batching behavior.
    return {
      startedAt,
      endedAt,
      points: routeRef.current,
      distanceKm: distanceKmRef.current,
      durationSec: secondsElapsedRef.current,
    };
  }, [stopWatcher, stopTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWatcher();
      stopTimer();
    };
  }, [stopWatcher, stopTimer]);

  return { ...state, start, pause, resume, end };
}
