"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { SessionPlan, SessionBlock } from "@/lib/coach";
import { logManualWorkout, coachChatTurn } from "@/app/(app)/home/actions";
import PreWorkout from "./PreWorkout";
import PostWorkout from "./PostWorkout";
import Analyzing from "./Analyzing";
import DoneState from "./DoneState";

export type HomeState = "pre-workout" | "post-workout" | "analyzing" | "done";

export interface WorkoutResult {
  summary: string;
  adjustments: string[];
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
  coachLevel,
  freezeActive,
  freezeReason,
  loggedToday,
  aiSummary,
  workoutLogId: initialWorkoutLogId,
}: HomeClientProps) {
  const t = useTranslations();
  const [state, setState] = useState<HomeState>("pre-workout");
  const [workoutResult, setWorkoutResult] = useState<WorkoutResult | null>(null);
  const [workoutLogId, setWorkoutLogId] = useState<string | null>(initialWorkoutLogId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogManual = useCallback(() => {
    setState("post-workout");
  }, []);

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
        const result = await logManualWorkout(formData);
        if (result.success) {
          setWorkoutResult({
            summary: result.summary,
            adjustments: result.adjustments,
          });
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
    [],
  );

  const handlePostWorkoutCancel = useCallback(() => {
    setState("pre-workout");
  }, []);

  const handleDoneBack = useCallback(() => {
    setState("pre-workout");
  }, []);

  const handleDoneChat = useCallback(
    async (message: string) => {
      if (!workoutLogId) return;
      try {
        const response = await coachChatTurn(message, workoutLogId);
        if ("error" in response) {
          console.error("Chat error:", response.error);
        }
      } catch (error) {
        console.error("Error sending chat message:", error);
      }
    },
    [workoutLogId],
  );

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
        />
      )}

      {state === "post-workout" && (
        <PostWorkout
          isSubmitting={isSubmitting}
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
