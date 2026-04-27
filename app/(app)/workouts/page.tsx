import { getTranslations } from "next-intl/server";
import { LogWorkoutForm } from "@/components/workouts/LogWorkoutForm";

export default async function WorkoutsPage() {
  const t = await getTranslations("log");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <LogWorkoutForm />
    </div>
  );
}
