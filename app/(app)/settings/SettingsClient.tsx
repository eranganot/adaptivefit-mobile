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
} from "lucide-react";
import { setLocale, disconnectGoogleFit, syncGoogleFit } from "./actions";
import { GoalForm } from "@/components/goals/GoalForm";

type Goal = {
  id: string;
  type: string;
  targetValue: string;
  targetDate: string;
  status: string;
  note: string | null;
};

interface SettingsClientProps {
  locale: "en" | "he";
  activeGoal: Goal | null;
  fitToken: { status: string; lastSyncAt: Date | null } | null;
}

export function SettingsClient({ locale, activeGoal, fitToken }: SettingsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isDark, setIsDark] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(!activeGoal);
  const [isSyncing, startSync] = useTransition();
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Surface URL params from OAuth callback
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
      const result = await syncGoogleFit();
      setSyncResult(result.success ? `Synced — ${result.daysFetched} days updated` : `Error: ${result.error}`);
      router.refresh();
    });
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Google Fit? This will delete your stored tokens.")) return;
    await disconnectGoogleFit();
    router.refresh();
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

        {/* Section 3: Goal */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <Target className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Goal
            </h2>
          </div>

          {activeGoal && !showGoalForm ? (
            <div>
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 rounded-2xl p-4 mb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white capitalize">
                      {activeGoal.type}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Target: {activeGoal.targetValue}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      By {new Date(activeGoal.targetDate).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      activeGoal.status === "active"
                        ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                    }`}
                  >
                    {activeGoal.status}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setShowGoalForm(true)}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-medium rounded-2xl transition-colors"
              >
                Edit Goal
              </button>
            </div>
          ) : (
            <div>
              {activeGoal && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Update your goal below:
                </p>
              )}
              <GoalForm
                onSuccess={() => {
                  setShowGoalForm(false);
                  router.refresh();
                }}
              />
            </div>
          )}

          {!activeGoal && !showGoalForm && (
            <p className="text-gray-600 dark:text-gray-400">
              No active goal. Create one to get started.
            </p>
          )}
        </div>

        {/* Section 4: Connections */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-3 mb-4">
            <Plug className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Connections
            </h2>
          </div>

          {/* OAuth callback banners */}
          {fitConnected === "1" && (
            <div className="flex items-center gap-2 rounded-2xl bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Google Fit connected! Initial sync is running in the background.
            </div>
          )}
          {fitError && (
            <div className="flex items-center gap-2 rounded-2xl bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Connection failed: {fitError}. Please try again.
            </div>
          )}
          {fitToken?.status === "error" && !fitError && (
            <div className="flex items-center gap-2 rounded-2xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Google Fit sync failed. Reconnect to restore access.
            </div>
          )}
          {syncResult && (
            <div className="flex items-center gap-2 rounded-2xl bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {syncResult}
            </div>
          )}

          {/* Google Fit row */}
          <div className="rounded-2xl bg-gray-50 dark:bg-slate-800 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Google Fit</p>
                  {fitToken && fitToken.status === "active" ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {fitToken.lastSyncAt
                        ? `Last synced ${new Date(fitToken.lastSyncAt).toLocaleDateString()}`
                        : "Connected — syncing…"}
                    </p>
                  ) : fitToken?.status === "error" ? (
                    <p className="text-xs text-rose-500">Sync error — reconnect</p>
                  ) : (
                    <p className="text-xs text-gray-400">Not connected</p>
                  )}
                </div>
              </div>

              {fitToken && fitToken.status !== "revoked" ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                </div>
              ) : (
                <button
                  onClick={() => { window.location.href = "/api/auth/google-fit"; }}
                  className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  Connect
                </button>
              )}
            </div>

            {fitToken && fitToken.status !== "revoked" && (
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
                  onClick={handleDisconnect}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </div>
            )}
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
