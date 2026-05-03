import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users, userLevelState } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { RoadmapView } from "@/components/roadmap/RoadmapView";
import { RoadmapHeader } from "@/components/roadmap/RoadmapHeader";
import { getRoadmapData } from "./data";

export default async function RoadmapPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const t = await getTranslations("roadmap");

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) redirect("/sign-in");

  const [{ sessions, weekIndex, totalWeeks }, stateRow] = await Promise.all([
    getRoadmapData(user.id),
    db.query.userLevelState.findFirst({ where: eq(userLevelState.userId, user.id) }),
  ]);

  const currentLevel = stateRow?.currentLevel ?? 1;
  const manualOverrideUntil = stateRow?.manualOverrideUntil ?? null;

  return (
    <div className="space-y-4">
      <RoadmapHeader
        title={t("title")}
        subtitle={t("thisWeek")}
        weekBadge={t("weekBadge", { week: weekIndex, total: totalWeeks })}
        currentLevel={currentLevel}
        manualOverrideUntil={manualOverrideUntil}
      />
      <RoadmapView sessions={sessions} />
    </div>
  );
}
