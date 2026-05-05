"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle, AlertCircle, Circle, AlertTriangle,
  Dumbbell, Footprints, Flame, Zap, Pencil, Trash2, X, Check,
} from "lucide-react";
import type { RoadmapSession } from "@/app/(app)/roadmap/data";
import { deleteRoadmapSession, updateRoadmapSession } from "@/app/(app)/roadmap/actions";

interface RoadmapViewProps {
  sessions: RoadmapSession[];
}

export function RoadmapView({ sessions }: RoadmapViewProps) {
  const t = useTranslations("roadmap");
  const router = useRouter();
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDir((document.documentElement.dir as "ltr" | "rtl") || "ltr");
  }, []);

  const startEdit = (session: RoadmapSession) => {
    setEditingId(session.id);
    setEditTitle(session.title);
    // Format date as YYYY-MM-DD for the date input
    const d = new Date(session.date);
    setEditDate(d.toISOString().split("T")[0]);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const handleSave = async (sessionId: string, originalTitle: string) => {
    setSaving(true);
    setError(null);
    const result = await updateRoadmapSession(sessionId, {
      newDate: editDate,
      newTitle: editTitle !== originalTitle ? editTitle : undefined,
    });
    setSaving(false);
    if (result.success) {
      setEditingId(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const handleDelete = async (sessionId: string) => {
    if (!confirm("Remove this session from the roadmap?")) return;
    setSaving(true);
    const result = await deleteRoadmapSession(sessionId);
    setSaving(false);
    if (result.success) {
      setEditingId(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 py-12 px-4">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40">
          <Zap className="h-6 w-6 text-indigo-500" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-slate-900 dark:text-slate-100">{t("emptyState")}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("emptyStateSub")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="space-y-4">
        {sessions.map((session, index) => {
          const statusConfig = getStatusConfig(session.status);
          const isRTL = dir === "rtl";
          const isEditing = editingId === session.id;
          const canEdit = session.status === "planned";

          return (
            <div key={session.id} className="relative flex items-start gap-3">
              {/* Timeline connector */}
              {index < sessions.length - 1 && (
                <div
                  className={`absolute top-10 h-[calc(100%+1rem)] w-px bg-slate-200 dark:bg-slate-700 ${
                    isRTL ? "right-[17px]" : "left-[17px]"
                  }`}
                  aria-hidden="true"
                />
              )}

              {/* Status icon */}
              <div
                className={`relative mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${statusConfig.iconBg} z-10`}
              >
                {statusConfig.icon}
              </div>

              {/* Card */}
              <div
                className={`flex-1 overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800 ${
                  session.status === "planned" && !isEditing
                    ? isRTL
                      ? "border-r-[3px] border-r-indigo-500"
                      : "border-l-[3px] border-l-indigo-500"
                    : isEditing
                    ? "border-indigo-400 dark:border-indigo-500 ring-1 ring-indigo-300 dark:ring-indigo-700"
                    : ""
                }`}
              >
                <div className="p-4">
                  {/* Top row: Date + Status pill + Edit button */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {formatDate(session.date)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusConfig.pillStyle}`}>
                        {t(`status.${session.status}`)}
                      </span>
                      {canEdit && !isEditing && (
                        <button
                          onClick={() => startEdit(session)}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-500 transition-colors"
                          title="Edit session"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isEditing && (
                        <button
                          onClick={cancelEdit}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Cancel edit"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Title — editable in edit mode */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-xl border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  ) : (
                    <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-2 leading-snug">
                      {session.title}
                    </h3>
                  )}

                  {/* Blocks list — hidden in edit mode to keep it clean */}
                  {!isEditing && session.blocks.length > 0 && (
                    <ul className="space-y-1.5 mb-1">
                      {session.blocks.map((block, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <span className="mt-0.5 flex-shrink-0 text-indigo-400">
                            {getBlockIcon(block.label)}
                          </span>
                          <span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">{block.label}:</span>{" "}
                            {block.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Adjusted note */}
                  {!isEditing && session.status === "adjusted" && session.adjustedNote && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-orange-50 dark:bg-orange-950/40 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-orange-700 dark:text-orange-400">{session.adjustedNote}</p>
                    </div>
                  )}

                  {/* ── Edit panel ─────────────────────────────────── */}
                  {isEditing && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                          Scheduled date
                        </label>
                        <input
                          type="date"
                          value={editDate}
                          min={new Date().toISOString().split("T")[0]}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>

                      {error && (
                        <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleSave(session.id, session.title)}
                          disabled={saving}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {saving ? "Saving…" : "Save changes"}
                        </button>
                        <button
                          onClick={() => handleDelete(session.id)}
                          disabled={saving}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
        iconBg: "bg-emerald-500",
        icon: <CheckCircle className="h-5 w-5 text-white" />,
        pillStyle: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400",
      };
    case "adjusted":
      return {
        iconBg: "bg-orange-400",
        icon: <AlertCircle className="h-5 w-5 text-white" />,
        pillStyle: "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400",
      };
    case "planned":
      return {
        iconBg: "bg-indigo-100 dark:bg-indigo-900/50",
        icon: <Circle className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />,
        pillStyle: "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400",
      };
  }
}

function getBlockIcon(label: string): React.ReactNode {
  const l = label.toLowerCase();
  if (l.includes("warm")) return <Flame className="h-3.5 w-3.5" />;
  if (l.includes("strength") || l.includes("exercise")) return <Dumbbell className="h-3.5 w-3.5" />;
  if (l.includes("run") || l.includes("interval") || l.includes("easy")) return <Footprints className="h-3.5 w-3.5" />;
  return <Zap className="h-3.5 w-3.5" />;
}

function formatDate(date: Date): string {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${days[date.getDay()]} ${date.getDate().toString().padStart(2, "0")} ${months[date.getMonth()]}`;
}
