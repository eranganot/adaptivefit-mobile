"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Globe,
  Sun,
  Moon,
  Target,
  Plug,
  Smartphone,
  LogOut,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Unplug,
  Gauge,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { setLocale, setManualLevelOverride, clearManualLevelOverride } from "./actions";
import { syncHealthConnect, type SyncResult } from "@/lib/fit/syncFromClient";
import { openSettings as openHealthConnectSettings } from "@/lib/fit/healthConnect";
import { GoalForm } from "@/components/goals/GoalForm";
import { archiveGoalById } from "@/lib/goals/actions";
import type { SettingsGoal } from "./page";
import { BodyMetricsSection } from "@/components/settings/BodyMetricsSection";
import type { WeightEntry } from "@/components/settings/BodyMetricsSection";

interface SettingsClientProps {
  locale: "en" | "he";
  activeGoals: SettingsGoal[];
  weightEntries: WeightEntry[];
  /** Last time fit_daily_metrics was updated for this user. null = never synced. */
  healthConnectLastSyncAt: Date | null;
  levelState: { currentLevel: number; manualOverride: boolean; manualOverrideUntil: Date | null } | null;
}

export function SettingsClient({ locale, activeGoals, weightEntries, healthConnectLastSyncAt, levelState }: SettingsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isDark, setIsDark] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [isSyncing, startSync] = useTransition();
  const [syncResult, setSyncResult] = useState<string | null>(null);
  // Bug #9 — manual level override
  const [overrideLevel, setOverrideLevel] = useState(levelState?.currentLevel ?? 1);
  const [isSavingLevel, setIsSavingLevel] = useState(false);
  const [levelResult, setLevelResult] = useState<string | null>(null);

  // Legacy OAuth callback params kept only so old in-flight redirects don't 404.
  // Health Connect has no OAuth — these are unused going forward.
  const fitConnected = searchParams.get("fit_connected");
  const fitError = searchParams.get("fit_error");

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const prefersDark =
      savedTheme === "dark" ||
      (savedTheme === null &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    setIsDark(prefersDark);

    if (prefersDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const handleLocaleChange = async (newLocale: "en" | "he") => {
    if (newLocale === locale) return;

    setIsLoading(true);
    try {
      const result = await setLocale(newLocale);
      if (result.success) {
        router.refresh();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleThemeChange = (theme: "light" | "dark") => {
    const isDarkMode = theme === "dark";
    setIsDark(isDarkMode);

    if (isDarkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const handleSignOut = async () => {
    await signOut({ redirectTo: "/" });
  };

  const handleSyncNow = () => {
    startSync(async () => {
      const result: SyncResult = await syncHealthConnect({ daysBack: 30, interactive: true });
      switch (result.kind) {
        case "ok":
          setSyncResult(`Synced — ${result.daysFetched} days updated`);
          break;
        case "unsupported":
          setSyncResult("Health Connect is only available on Android.");
          break;
        case "not-installed":
          setSyncResult("Install Health Connect from the Play Store to sync.");
          break;
        case "needs-update":
          setSyncResult("Update Health Connect from the Play Store, then try again.");
          break;
        case "permission-denied":
          setSyncResult("Permission denied. Grant data access in Health Connect settings.");
          break;
        case "error":
          setSyncResult(`Error: ${result.message}`);
          break;
      }
      router.refresh();
    });
  };

  const handleArchiveGoal = async (goalId: string) => {
    if (!confirm("Archive this goal? It will no longer influence your roadmap.")) return;
    setArchivingId(goalId);
    const result = await archiveGoalById(goalId);
    setArchivingId(null);
    if (result.success) router.refresh();
  };

  // Health Connect has no "disconnect" server-side (no OAuth tokens).
  // To revoke data access, the user goes through Health Connect's own
  // settings UI — we just deep-link them there.
  const handleOpenHcSettings = async () => {
    try {
      await openHealthConnectSettings();
    } catch (e) {
      console.warn("Could not open Health Connect settings:", e);
    }
  };

  // Bug #9 — manual level override handlers
  const handleSaveLevel = async () => {
    setIsSavingLevel(true);
    setLevelResult(null);
    const result = await setManualLevelOverride(overrideLevel);
    setIsSavingLevel(false);
    if (result.success) {
      setLevelResult(`Level ${overrideLevel} set — override active for 7 days`);
      router.refresh();
    } else {
      setLevelResult(`Error: ${result.error}`);
    }
  };

  const handleClearOverride = async () => {
    setIsSavingLevel(true);
    setLevelResult(null);
    const result = await clearManualLevelOverride();
    setIsSavingLevel(false);
    if (result.success) {
      setLevelResult("Override cleared — coach FSM resumes");
      router.refresh();
    } else {
      setLevelResult(`Error: ${result.error}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your preferences and account
          </p>
        </div>

        {/* Section 1: Language */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Language
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleLocaleChange("en")}
              disabled={isLoading}
              className={`p-3 rounded-2xl font-medium transition-all ${
                locale === "en"
                  ? "ring-2 ring-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100"
                  : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700"
              } disabled:opacity-50`}
            >
              <div className="font-semibold">English</div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                LTR
              </div>
            </button>

            <button
              onClick={() => handleLocaleChange("he")}
              disabled={isLoading}
              className={`p-3 rounded-2xl font-medium transition-all ${
                locale === "he"
                  ? "ring-2 ring-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100"
                  : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700"
              } disabled:opacity-50`}
            >
              <div className="font-semibold">עברית</div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                RTL
              </div>
            </button>
          </div>
        </div>

        {/* Section 2: Appearance */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-3 mb-4">
            <Sun className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Appearance
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleThemeChange("light")}
              className={`p-3 rounded-2xl font-medium transition-all flex items-center justify-center gap-2 ${
                !isDark
                  ? "ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100"
                  : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700"
              }`}
            >
              <Sun className="w-4 h-4" />
              Light
            </button>

            <button
              onClick={() => handleThemeChange("dark")}
              className={`p-3 rounded-2xl font-medium transition-all flex items-center justify-center gap-2 ${
                isDark
                  ? "ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100"
                  : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700"
              }`}
            >
              <Moon className="w-4 h-4" />
              Dark
            </button>
          </div>
        </div>

        {/* Section 3: Goals (R3 — multi-goal) */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <Target className="w-5 h-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Goals</h2>
            </div>
            <button
              onClick={() => setShowGoalForm((v) => !v)}
              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              {showGoalForm ? "Cancel" : "+ Add Goal"}
            </button>
          </div>

          {/* Active goals list */}
          {activeGoals.length === 0 && !showGoalForm && (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
              No active goals yet — tap &ldquo;+ Add Goal&rdquo; to get started.
            </p>
          )}

          {activeGoals.map((goal, i) => {
            const CATEGORY_EMOJI: Record<string, string> = {
              running: "🏃", weight_loss: "⚖️", body_shape: "💪", strength: "🏋️",
            };
            const isPrimary = i === 0;
            return (
              <div
                key={goal.id}
                className={`rounded-2xl p-4 ${
                  isPrimary
                    ? "bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/60 dark:to-purple-950/60 border border-indigo-200 dark:border-indigo-800"
                    : "bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{CATEGORY_EMOJI[goal.category] ?? "🎯"}</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 capitalize">
                          {goal.category.replace("_", " ")}
                        </p>
                        {isPrimary && (
                          <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Target: {goal.targetValue} · By {new Date(goal.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleArchiveGoal(goal.id)}
                    disabled={archivingId === goal.id}
                    className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
                  >
                    {archivingId === goal.id ? "…" : "Archive"}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add goal form (inline) */}
          {showGoalForm && (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-2">
              <GoalForm
                onSuccess={() => {
                  setShowGoalForm(false);
                  router.refresh();
                }}
              />
            </div>
          )}
        </div>

        {/* Section 3b: Weight Log (A2) */}
        <BodyMetricsSection entries={weightEntries} />

        {/* Section 3c: Training Level — Bug #9 */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <Gauge className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Training Level
            </h2>
          </div>

          {/* Current level badge */}
          <div className="flex items-center justify-between rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">
                Current level
              </p>
              <p className="text-3xl font-bold text-indigo-700 dark:text-indigo-300 mt-0.5">
                {levelState?.currentLevel ?? "—"}
                <span className="text-sm font-normal text-slate-500 dark:text-slate-400 ml-1">/ 10</span>
              </p>
            </div>
            {levelState?.manualOverride && levelState.manualOverrideUntil && (
              <div className="text-right">
                <span className="inline-block rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Manual override
                </span>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                  Until {new Date(levelState.manualOverrideUntil).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          {/* Level picker */}
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Override level:{" "}
              <span className="text-indigo-600 dark:text-indigo-400">{overrideLevel}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOverrideLevel((l) => Math.max(1, l - 1))}
                disabled={overrideLevel <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <div className="flex flex-1 gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setOverrideLevel(lvl)}
                    className={`flex-1 h-8 rounded-lg text-xs font-semibold transition-colors ${
                      overrideLevel === lvl
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setOverrideLevel((l) => Math.min(10, l + 1))}
                disabled={overrideLevel >= 10}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 disabled:opacity-40"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 text-center">
              1–3: beginner · 4–6: casual · 7–8: regular · 9–10: advanced
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleSaveLevel}
              disabled={isSavingLevel}
              className="flex-1 rounded-2xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {isSavingLevel ? "Saving…" : "Set Level (7 days)"}
            </button>
            {levelState?.manualOverride && (
              <button
                onClick={handleClearOverride}
                disabled={isSavingLevel}
                className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>

          {levelResult && (
            <p className="text-xs text-center text-slate-500 dark:text-slate-400">{levelResult}</p>
          )}
        </div>

        {/* Section 4: Connections — Health Connect (Phase 8 migration) */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-3 mb-4">
            <Plug className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Connections
            </h2>
          </div>

          {/* Legacy OAuth callback banners (older deploys may still redirect here) */}
          {fitConnected === "1" && (
            <div className="flex items-center gap-2 rounded-2xl bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              You&apos;re connected. Use &apos;Sync now&apos; below to pull data via Health Connect.
            </div>
          )}
          {fitError && (
            <div className="flex items-center gap-2 rounded-2xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Old Google Fit OAuth flow returned an error (this integration has been replaced by Health Connect — try Sync now below).
            </div>
          )}
          {syncResult && (
            <div className="flex items-center gap-2 rounded-2xl bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {syncResult}
            </div>
          )}

          {/* Health Connect row */}
          <div className="rounded-2xl bg-gray-50 dark:bg-slate-800 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Health Connect</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {healthConnectLastSyncAt
                      ? `Last synced ${new Date(healthConnectLastSyncAt).toLocaleDateString()} ${new Date(healthConnectLastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Not synced yet — tap Sync now"}
                  </p>
                </div>
              </div>
              {healthConnectLastSyncAt && (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={handleSyncNow}
                disabled={isSyncing}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing…" : "Sync now"}
              </button>
              <button
                onClick={handleOpenHcSettings}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                title="Open Health Connect's own settings to manage which apps share data"
              >
                <Unplug className="h-3.5 w-3.5" />
                Settings
              </button>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
              Health Connect runs on Android only and reads data your other fitness apps
              (Google Fit, Samsung Health, Fitbit, etc.) write to it. To revoke access, tap
              <span className="font-medium"> Settings</span> above or open Health Connect from your phone&apos;s app drawer.
            </p>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white font-medium rounded-3xl transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
