import { getTranslations } from "next-intl/server";

export default async function WorkoutsPage() {
  const t = await getTranslations("log");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">Log form lands here on Day 3.</p>
    </div>
  );
}
