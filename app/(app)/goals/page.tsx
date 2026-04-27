import { getTranslations } from "next-intl/server";

export default async function GoalsPage() {
  const t = await getTranslations("goals");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("empty")}</p>
    </div>
  );
}
