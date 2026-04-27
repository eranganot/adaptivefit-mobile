import { auth } from "@/lib/auth";
import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const session = await auth();
  const t = await getTranslations("home");
  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? "greetingMorning" : hour < 18 ? "greetingAfternoon" : "greetingEvening";
  const name = session?.user?.name?.split(" ")[0] ?? "there";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t(greetingKey, { name })}</h1>
      <div className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
        <p className="text-sm text-muted-foreground">{t("todayPlanned")}</p>
        <p className="mt-2 text-lg font-medium">3 × 1.5 km blocks @ 7:00 min/km</p>
        <p className="mt-1 text-sm text-muted-foreground">5 min warmup · Bird-Dog · Plank</p>
        <button className="mt-4 w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground">
          {t("logWorkout")}
        </button>
      </div>
      <div className="rounded-2xl border bg-card p-4 text-card-foreground shadow-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("coachState")}</p>
        <p className="mt-1 font-medium">{t("level", { level: 1 })}</p>
      </div>
    </div>
  );
}
