"use client";

import { useState, useCallback } from "react";
import type { SessionPlan } from "@/lib/coach";
import type { GpsRawPoint } from "@/lib/run/haversine";
import { logManualWorkout, coachChatTurn } from "@/app/(app)/home/actions";
import { endRunSession } from "@/app/(app)/home/runActions";
import PreWorkout from "./PreWorkout";
import PostWorkout from "./PostWorkout";
import Analyzing from "./Analyzing";
import DoneState from "./DoneState";
import dynamic from "next/dynamic";

// Lazy-load GPS-heavy screens — they import mapbox which is large
const ActiveRun = dynamic(() => import("./ActiveRun"), { ssr: false });
const RunSummary = dynamic(() => import("./RunSummary"), { ssr: false });

export type HomeState =
  | "pre-workout"
  | "active-run"
  | "run-summary"
  | "post-workout"
  | "analyzing"
  | "done";

export interface WorkoutResult {
  summary: string;
  adjustments: string[];
}

export interface RunEndData {
  startedAt: Date;
  endedAt: Date;
  points: GpsRawPoint[];
  distanceKm: number;
  durationSec: number;
  runSessionId?: string;
}

export interface HomeClientProps {
  name: string;
  greetingKey: "greetingMorning" | "greetingAfternoon" | "greetingEvening";
  todayPlan: SessionPlan | null;
  coachLevel: number;
  freezeActive: boolean;
  freezeReason: string | null;
  loggedToday: boolean;
  aiSummary: string | null;
  workoutLogId: string | null;
}

export default function HomeClient({
  name,
  greetingKey,
  todayPlan,
  coachLevel: _coachLevel,
  freezeActive: _freezeActive,
  freezeReason: _freezeReason,
  loggedToday,
  aiSummary,
  workoutLogId: initialWorkoutLogId,
}: HomeClientProps) {
  const [state, setState] = useState<HomeState>("pre-workout");
  const [workoutResult, setWorkoutResult] = useState<WorkoutResult | null>(null);
  const [workoutLogId, setWorkoutLogId] = useState<string | null>(initialWorkoutLogId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runEndData, setRunEndData] = useState<RunEndData | null>(null);
  // Pre-filled RPE for post-workout form when coming from GPS run (default Moderate = 5)
  const [prefillRpe, setPrefillRpe] = useState<number | undefined>(undefined);

  // ── Manual log flow ───────────────────────────────────────────
  const handleLogManual = useCallback(() => {
    setPrefillRpe(undefined);
    setState("post-workout");
  }, []);

  // ── GPS run flow ──────────────────────────────────────────────
  const handleStartRun = useCallback(() => {
    setState("active-run");
  }, []);

  const handleRunEnd = useCallback(
    async (data: {
      startedAt: Date;
      endedAt: Date;
      points: GpsRawPoint[];
      distanceKm: number;
      durationSec: number;
    }) => {
      // Persist to DB (non-blocking for UI transition)
      let runSessionId: string | undefined;
      try {
        const result = await endRunSession(data);
        if (result.success) runSessionId = result.runSessionId;
      } catch (e) {
        console.error("endRunSession error:", e);
      }
      setRunEndData({ ...data, runSessionId });
      setState("run-summary");
    },
    [],
  );

  const handleGetFeedback = useCallback(
    (rpeEstimate: number) => {
      setPrefillRpe(rpeEstimate);
      setState("post-workout");
    },
    [],
  );

  // ── Post-workout submission ───────────────────────────────────
  const handlePostWorkoutSubmit = useCallback(
    async (formData: {
      rpe: number;
      footPain: number;
      notes: string;
      photo: File | null;
    }) => {
      setIsSubmitting(true);
      try {
        setState("analyzing");
        const result = await logManualWorkout({
          ...formData,
          runSessionId: runEndData?.runSessionId,
        });
        if (result.success) {
          setWorkoutResult({ summary: result.summary, adjustments: result.adjustments });
          setWorkoutLogId(result.workoutLogId);
          setState("done");
        } else {
          console.error("Failed to log workout:", result.error);
          setState("post-workout");
        }
      } catch (error) {
        console.error("Error submitting workout:", error);
        setState("post-workout");
      } finally {
        setIsSubmitting(false);
      }
    },
    [runEndData],
  );

  const handlePostWorkoutCancel = useCallback(() => {
    setState(runEndData ? "run-summary" : "pre-workout");
  }, [runEndData]);

  const handleDoneBack = useCallback(() => {
    setState("pre-workout");
    setRunEndData(null);
  }, []);

  const handleDoneChat = useCallback(
    async (message: string) => {
      if (!workoutLogId) return;
      try {
        const response = await coachChatTurn(message, workoutLogId);
        if ("error" in response) console.error("Chat error:", response.error);
      } catch (error) {
        console.error("Error sending chat message:", error);
      }
    },
    [workoutLogId],
  );

  const sessionTitle = todayPlan?.title ?? "Today's Run";

  return (
    <div className="space-y-4">
      {state === "pre-workout" && (
        <PreWorkout
          name={name}
          greetingKey={greetingKey}
          todayPlan={todayPlan}
          loggedToday={loggedToday}
          aiSummary={aiSummary}
          onLogManual={handleLogManual}
          onStartRun={handleStartRun}
        />
      )}

      {state === "active-run" && (
        <ActiveRun sessionTitle={sessionTitle} onEnd={handleRunEnd} />
      )}

      {state === "run-summary" && runEndData && (
        <RunSummary
          distanceKm={runEndData.distanceKm}
          durationSec={runEndData.durationSec}
          points={runEndData.points}
          onGetFeedback={handleGetFeedback}
        />
      )}

      {state === "post-workout" && (
        <PostWorkout
          isSubmitting={isSubmitting}
          prefillRpe={prefillRpe}
          onSubmit={handlePostWorkoutSubmit}
          onCancel={handlePostWorkoutCancel}
        />
      )}

      {state === "analyzing" && <Analyzing />}

      {state === "done" && (workoutResult || loggedToday) && (
        <DoneState
          summary={workoutResult?.summary ?? aiSummary ?? "Workout logged!"}
          adjustments={workoutResult?.adjustments ?? []}
          onBack={handleDoneBack}
          onChat={handleDoneChat}
          workoutLogId={workoutLogId}
        />
      )}
    </div>
  );
}
