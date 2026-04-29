"use client";

import { useTranslations } from "next-intl";
import { Brain } from "lucide-react";

export default function Analyzing() {
  const t = useTranslations();

  return (
    <div className="flex flex-col items-center justify-center py-16">
      {/* Concentric rings with brain icon */}
      <div className="relative flex items-center justify-center h-20 w-20">
        {/* Outer ring - ping animation */}
        <div className="absolute h-20 w-20 rounded-full bg-blue-200 animate-ping dark:bg-blue-900/40" />

        {/* Inner ring - pulse animation with blue-100 bg */}
        <div className="absolute h-16 w-16 rounded-full bg-blue-100 animate-pulse dark:bg-blue-900/30" />

        {/* Brain icon */}
        <Brain className="relative h-12 w-12 text-blue-600 dark:text-blue-400" />
      </div>

      {/* Caption */}
      <p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
        {t("analyzing.caption")}
      </p>
    </div>
  );
}
