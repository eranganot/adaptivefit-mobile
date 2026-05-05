"use client";

import { useState } from "react";
import { MoreVertical, RefreshCw } from "lucide-react";
import { LevelOverrideSheet } from "./LevelOverrideSheet";
import { regenerateMyRoadmap } from "@/app/(app)/roadmap/actions";
import { useRouter } from "next/navigation";

interface RoadmapHeaderProps {
  title: string;
  subtitle: string;
  weekBadge: string;
  currentLevel: number;
  manualOverrideUntil: Date | null;
}

export function RoadmapHeader({
  title,
  subtitle,
  weekBadge,
  currentLevel,
  manualOverrideUntil,
}: RoadmapHeaderProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const overrideActive =
    manualOverrideUntil != null && new Date(manualOverrideUntil) > new Date();

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateMyRoadmap();
      router.refresh();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
            {weekBadge}
          </span>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
            title="Regenerate plan"
          >
            <RefreshCw className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setSheetOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Set coach level"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {overrideActive && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Manual level {currentLevel} active until{" "}
            {new Date(manualOverrideUntil!).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      )}

      <LevelOverrideSheet
        currentLevel={currentLevel}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
