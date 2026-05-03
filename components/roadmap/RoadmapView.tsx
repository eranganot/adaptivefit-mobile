"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, AlertCircle, Circle, AlertTriangle } from "lucide-react";
import type { RoadmapSession } from "@/app/(app)/roadmap/data";

interface RoadmapViewProps {
  sessions: RoadmapSession[];
}

export function RoadmapView({ sessions }: RoadmapViewProps) {
  const t = useTranslations("roadmap");
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  useEffect(() => {
    setDir((document.documentElement.dir as "ltr" | "rtl") || "ltr");
  }, []);

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 px-4">
        <div className="text-center">
          <p className="font-semibold text-slate-900">{t("emptyState")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("emptyStateSub")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline container */}
      <div className="space-y-6">
        {sessions.map((session, index) => {
          const statusConfig = getStatusConfig(session.status);
          const isRTL = dir === "rtl";

          return (
            <div key={session.id} className="relative flex items-start gap-4">
              {/* Timeline line - positioned absolutely */}
              {index < sessions.length - 1 && (
                <div
                  className={`absolute top-12 h-16 w-0.5 bg-slate-200 ${
                    isRTL ? "right-4" : "left-4"
                  }`}
                  aria-hidden="true"
                />
              )}

              {/* Status icon circle */}
              <div
                className={`relative mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${statusConfig.bgColor} z-10`}
              >
                {statusConfig.icon}
              </div>

              {/* Card content */}
              <div
                className={`flex-1 rounded-2xl shadow-sm bg-white p-4 ${
                  isRTL ? "mr-4" : ""
                }`}
              >
                {/* Top row: Date + Status pill */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {formatDate(session.date)}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-1 rounded-full ${statusConfig.pillStyle}`}
                  >
                    {t(`status.${session.status}`)}
                  </span>
                </div>

                {/* Title */}
                <h3 className="font-semibold text-sm text-slate-900 mb-2">
                  {session.title}
                </h3>

                {/* Blocks list */}
                {session.blocks.length > 0 && (
                  <ul className="space-y-1 mb-3">
                    {session.blocks.map((block, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        <span className="inline-block mr-2">•</span>
                        <span className="font-medium">{block.label}:</span> {block.detail}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Adjusted note banner */}
                {session.status === "adjusted" && session.adjustedNote && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-orange-50 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-orange-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-orange-700">{session.adjustedNote}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getStatusConfig(status: "completed" | "adjusted" | "planned") {
  switch (status) {
    case "completed":
      return {
        bgColor: "bg-emerald-500",
        icon: <CheckCircle className="h-5 w-5 text-white" />,
        pillStyle: "bg-emerald-100 text-emerald-700",
      };
    case "adjusted":
      return {
        bgColor: "bg-orange-400",
        icon: <AlertCircle className="h-5 w-5 text-white" />,
        pillStyle: "bg-orange-100 text-orange-700",
      };
    case "planned":
      return {
        bgColor: "bg-slate-200",
        icon: <Circle className="h-5 w-5 text-slate-400" />,
        pillStyle: "bg-slate-100 text-slate-500",
      };
  }
}

function formatDate(date: Date): string {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const dayName = days[date.getDay()];
  const dayNum = date.getDate().toString().padStart(2, "0");
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthName = months[date.getMonth()];

  return `${dayName} ${dayNum} ${monthName}`;
}
