import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { RoadmapView } from "@/components/roadmap/RoadmapView";
import { getRoadmapData } from "./data";

export default async function RoadmapPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const t = await getTranslations("roadmap");

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) redirect("/sign-in");

  const { sessions, weekIndex, totalWeeks } = await getRoadmapData(user.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("thisWeek")}</p>
        </div>
        <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
          {t("weekBadge", { week: weekIndex, total: totalWeeks })}
        </span>
      </div>
      <RoadmapView sessions={sessions} />
    </div>
  );
}
