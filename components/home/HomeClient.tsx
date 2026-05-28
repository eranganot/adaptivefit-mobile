"use client";

import { useState, useCallback, useEffect } from "react";
import type { SessionPlan } from "@/lib/coach";
import type { GpsRawPoint } from "@/lib/run/haversine";
import { logManualWorkout, coachChatTurn } from "@/app/(app)/home/actions";
import { endRunSession } from "@/app/(app)/home/runActions";
import { peekPersistedRun, discardPersistedRun } from "@/lib/run/tracker";
import {
  BackgroundLocationExplainer,
  useBackgroundLocationExplainer,
} from "@/components/run/BackgroundLocationExplainer";
import PreWorkout from "./PreWorkout";
import PostWorkout from "./PostWorkout";
import Analyzing from "./Analyzing";
import DoneState from "./DoneState";
import { ColdStartReviewModal } from "@/components/coldstart/ColdStartReviewModal";
import { PendingClassificationsCard } from "./PendingClassificationsCard";
import type { PendingClassification } from "@/app/(app)/home/sessionClassificationActions";
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
  clientRunId?: string;
}

export interface HomeClientProps {
  name: string;
  greetingKey: "greetingMorning" | "greetingAfternoon" | "greetingEvening";
  todayPlan: SessionPlan | null;
  /** True when todayPlan came from a training_roadmap row matching today's date.
   *  False when it's the FSM fallback (no roadmap row for today). */
  todayPlanIsFromRoadmap: boolean;
  /** The calendar date the todayPlan card represents. Always today when there's
   *  a roadmap row for today; defaults to today when falling back to FSM. */
  todayPlanDate: Date;
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
  /** External HC sessions awaiting user classification (training vs activity).
   *  Shown as the PendingClassificationsCard in pre-workout state. Defaults to
   *  empty array on the server so consumers without HC sessions don't break. */
  pendingClassifications?: PendingClassification[];
}

export default function HomeClient({
  name,
  greetingKey,
  todayPlan,
  todayPlanIsFromRoadmap,
  todayPlanDate,
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
  pendingClassifications = [],
}: HomeClientProps) {
  const [state, setState] = useState<HomeState>("pre-workout");
  const [workoutResult, setWorkoutResult] = useState<WorkoutResult | null>(null);
  const [workoutLogId, setWorkoutLogId] = useState<string | null>(initialWorkoutLogId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runEndData, setRunEndData] = useState<RunEndData | null>(null);
  // If true, ActiveRun will hydrate from IndexedDB on mount instead of starting fresh.
  const [restoreRunFromStorage, setRestoreRunFromStorage] = useState(false);
  // Native-only: show the background-location explainer modal before
  // triggering the OS permission prompts on the first run.
  const bgExplainer = useBackgroundLocationExplainer();
  const [pendingStart, setPendingStart] = useState(false);
  // Pre-filled RPE for post-workout form when coming from GPS run (default Moderate = 5)
  const [prefillRpe, setPrefillRpe] = useState<number | undefined>(undefined);
  // Cold-start modal (Bug #8)
  const [pendingColdStart, setPendingColdStart] = useState(initialPendingColdStart);

  // ── Auto-resume on mount ──────────────────────────────────────
  // If a run is in progress in IndexedDB (because the user closed the app /
  // killed the browser during a run), skip the pre-workout screen and jump
  // straight back to the live tracker. The tracker hook handles rehydration.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await peekPersistedRun();
        if (cancelled || !snap) return;
        setRestoreRunFromStorage(true);
        setState("active-run");
      } catch (e) {
        console.warn("[HomeClient] peekPersistedRun failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Manual log flow ───────────────────────────────────────────
  const handleLogManual = useCallback(() => {
    setPrefillRpe(undefined);
    setSubmitError(null);
    setState("post-workout");
  }, []);

  // ── GPS run flow ──────────────────────────────────────────────
  const handleStartRun = useCallback(() => {
    setRestoreRunFromStorage(false);
    // On native (Capacitor) we show a one-time explainer modal before
    // the OS permission prompts fire. On web (or returning native users),
    // jump straight to the live tracker.
    if (bgExplainer.needsExplanation) {
      setPendingStart(true);
      return;
    }
    setState("active-run");
  }, [bgExplainer.needsExplanation]);

  const handleAcknowledgeExplainer = useCallback(() => {
    bgExplainer.dismiss();
    setPendingStart(false);
    setState("active-run");
  }, [bgExplainer]);

  const handleRunEnd = useCallback(
    async (data: {
      startedAt: Date;
      endedAt: Date;
      points: GpsRawPoint[];
      distanceKm: number;
      durationSec: number;
      clientRunId: string;
    }) => {
      // Finalize on the server. endRunSession is idempotent on clientRunId
      // (see runActions.ts) so it merges with any partial row already created
      // by the 15s sync loop.
      let runSessionId: string | undefined;
      try {
        const result = await endRunSession(data);
        if (result.success) runSessionId = result.runSessionId;
      } catch (e) {
        console.error("endRunSession error:", e);
      }
      // Only clear local persistence after the server has the final row, so
      // a failed final upload still leaves a resumable run on the device.
      if (runSessionId) {
        try {
          await discardPersistedRun();
        } catch (e) {
          console.warn("[HomeClient] discardPersistedRun failed:", e);
        }
      }
      setRestoreRunFromStorage(false);
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
      // Phase 8b.2: explicit type + optional manual run metrics. Linked
      // GPS-run logs leave distanceKm/durationSec undefined here so the
      // server can copy authoritative values from the run_sessions row.
      type: "run" | "strength" | "mobility" | "other";
      distanceKm?: number;
      durationSec?: number;
      // Phase 8b.3: strength entries. Empty/omitted for non-strength types.
      strengthEntries?: Array<{
        exercise: string;
        weightKg: number;
        reps: number;
        sets: number;
      }>;
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

      {/* First-run-only background-location explainer (native shell only) */}
      <BackgroundLocationExplainer
        open={pendingStart && bgExplainer.needsExplanation}
        onAcknowledge={handleAcknowledgeExplainer}
      />

      {state === "pre-workout" && (
        <>
          {/* Pending external-session classifications. Renders only if there
              are any — invisible on quiet days. */}
          {pendingClassifications.length > 0 && (
            <PendingClassificationsCard pending={pendingClassifications} />
          )}
          <PreWorkout
            name={name}
            greetingKey={greetingKey}
            todayPlan={todayPlan}
            todayPlanIsFromRoadmap={todayPlanIsFromRoadmap}
            todayPlanDate={todayPlanDate}
            loggedToday={loggedToday}
            todayLogCount={todayLogCount}
            aiSummary={aiSummary}
            onLogManual={handleLogManual}
            onStartRun={handleStartRun}
            fitYesterday={fitYesterday}
            nextSession={nextSession}
            lastChatMessages={lastChatMessages}
          />
        </>
      )}

      {state === "active-run" && (
        <ActiveRun
          sessionTitle={sessionTitle}
          restoreFromStorage={restoreRunFromStorage}
          onEnd={handleRunEnd}
        />
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
            hasLinkedRunSession={Boolean(runEndData?.runSessionId)}
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
