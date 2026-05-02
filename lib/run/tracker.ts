"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  haversineKm,
  isPointValid,
  windowedPace,
  type GpsRawPoint,
  type GpsSplit,
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

        const prev = lastAcceptedRef.current;
        const segKm = prev ? haversineKm(prev.lat, prev.lon, point.lat, point.lon) : 0;
        lastAcceptedRef.current = point;

        setState((s) => {
          if (isPausedRef.current) return s; // don't accumulate while paused
          const newRoute = [...s.route, point];
          const newDist = s.distanceKm + segKm;
          const pace = windowedPace(newRoute);
          return {
            ...s,
            status: "running",
            distanceKm: newDist,
            paceSecPerKm: pace,
            currentPosition: { lat: point.lat, lon: point.lon },
            route: newRoute,
          };
        });
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
        setState((s) => ({ ...s, secondsElapsed: s.secondsElapsed + 1 }));
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

    let finalState: RunTrackerState | null = null;
    setState((s) => {
      finalState = { ...s, status: "ended" };
      return finalState;
    });

    // Give setState a chance to flush; return snapshot synchronously
    // The caller gets route from state after end()
    return {
      startedAt,
      endedAt,
      points: finalState ? (finalState as RunTrackerState).route : [],
      distanceKm: finalState ? (finalState as RunTrackerState).distanceKm : 0,
      durationSec: finalState ? (finalState as RunTrackerState).secondsElapsed : 0,
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
