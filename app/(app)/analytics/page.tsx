import { getTranslations } from "next-intl/server";

export default async function AnalyticsPage() {
  const t = await getTranslations("analytics");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">Dual-axis dashboard lands here on Day 5.</p>
    </div>
  );
}
