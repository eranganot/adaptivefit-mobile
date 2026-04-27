import { getTranslations } from "next-intl/server";
import { LogWorkoutForm } from "@/components/workouts/LogWorkoutForm";
import { WorkoutHistory } from "@/components/workouts/WorkoutHistory";
import { Suspense } from "react";

export default async function WorkoutsPage() {
  const t = await getTranslations("log");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <LogWorkoutForm />
      <Suspense
        fallback={
          <p className="text-center text-sm text-muted-foreground py-4">Loading history…</p>
        }
      >
        <WorkoutHistory />
      </Suspense>
    </div>
  );
}
