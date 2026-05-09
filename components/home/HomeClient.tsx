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
import { ColdStartReviewModal } from "@/components/coldstart/ColdStartReviewModal";
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
  todayLogCount: number;
  aiSummary: string | null;
  workoutLogId: string | null;
  fitYesterday: { steps: number | null; activeMinutes: number | null } | null;
  nextSession: { title: string; date: Date; plan: SessionPlan } | null;
  lastChatMessages: { role: string; content: string }[];
  pendingColdStart: { id: string; recommendedLevel: number; rationale: string } | null;
}

export default function HomeClient({
  name,
  greetingKey,
  todayPlan,
  coachLevel: _coachLevel,
  freezeActive: _freezeActive,
  freezeReason: _freezeReason,
  loggedToday,
  todayLogCount,
  aiSummary,
  workoutLogId: initialWorkoutLogId,
  fitYesterday,
  nextSession,
  lastChatMessages,
  pendingColdStart: initialPendingColdStart,
}: HomeClientProps) {
  const [state, setState] = useState<HomeState>("pre-workout");
  const [workoutResult, setWorkoutResult] = useState<WorkoutResult | null>(null);
  const [workoutLogId, setWorkoutLogId] = useState<string | null>(initialWorkoutLogId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runEndData, setRunEndData] = useState<RunEndData | null>(null);
  // Pre-filled RPE for post-workout form when coming from GPS run (default Moderate = 5)
  const [prefillRpe, setPrefillRpe] = useState<number | undefined>(undefined);
  // Cold-start modal (Bug #8)
  const [pendingColdStart, setPendingColdStart] = useState(initialPendingColdStart);

  // ── Manual log flow ───────────────────────────────────────────
  const handleLogManual = useCallback(() => {
    setPrefillRpe(undefined);
    setSubmitError(null);
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
      setSubmitError(null);
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
          setSubmitError("Couldn't save your workout. Please try again.");
          setState("post-workout");
        }
      } catch (error) {
        console.error("Error submitting workout:", error);
        setSubmitError("Something went wrong. Please try again.");
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
    // Reset workout context so a follow-up log starts fresh (Bug #2 guard)
    setWorkoutLogId(null);
    setWorkoutResult(null);
  }, []);

  const handleDoneChat = useCallback(
    async (message: string): Promise<string> => {
      if (!workoutLogId) return "";
      try {
        const response = await coachChatTurn(message, workoutLogId);
        if ("error" in response) {
          console.error("Chat error:", response.code, response.error);
          switch (response.code) {
            case "auth":
              return "Sign in again to chat with your coach.";
            case "limit":
              return "This thread reached its 10-turn limit. Start a fresh thread by ending this workout.";
            case "gemini":
              return "Coach service is temporarily unavailable. Try again in a minute.";
            case "db":
              return "Couldn't save your message. Try again.";
            default:
              return "Sorry, something went wrong. Please try again.";
          }
        }
        return response.reply;
      } catch (error) {
        console.error("Error sending chat message:", error);
        return "Sorry, something went wrong. Please try again.";
      }
    },
    [workoutLogId],
  );

  const sessionTitle = todayPlan?.title ?? "Today's Run";

  return (
    <div className="space-y-4">
      {/* Cold-start recommendation modal (Bug #8) */}
      {pendingColdStart && (
        <ColdStartReviewModal
          coldStartId={pendingColdStart.id}
          recommendedLevel={pendingColdStart.recommendedLevel}
          rationale={pendingColdStart.rationale}
          onDone={() => setPendingColdStart(null)}
        />
      )}

      {state === "pre-workout" && (
        <PreWorkout
          name={name}
          greetingKey={greetingKey}
          todayPlan={todayPlan}
          loggedToday={loggedToday}
          todayLogCount={todayLogCount}
          aiSummary={aiSummary}
          onLogManual={handleLogManual}
          onStartRun={handleStartRun}
          fitYesterday={fitYesterday}
          nextSession={nextSession}
          lastChatMessages={lastChatMessages}
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
        <>
          {submitError && (
            <div className="rounded-2xl bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
              {submitError}
            </div>
          )}
          <PostWorkout
            isSubmitting={isSubmitting}
            prefillRpe={prefillRpe}
            onSubmit={handlePostWorkoutSubmit}
            onCancel={handlePostWorkoutCancel}
          />
        </>
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
