"use client";

import { useEffect, useState } from "react";
import { MapPin, Bell, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { isNativePlatform } from "@/lib/run/nativeGeolocation";

/**
 * One-time explainer shown on the native app before we trigger the OS
 * permission prompts. Sets the user's expectations so:
 *
 *   1. The "Allow location all the time" prompt doesn't feel invasive —
 *      they know why we're asking.
 *   2. The persistent notification doesn't feel like spam — they know
 *      it's required by Android and how to recognize it.
 *
 * Behavior:
 *   - Only renders inside the Capacitor native shell (web users see no
 *     prompt; the browser geolocation API handles its own permission flow).
 *   - Shows on first run only — dismisses to localStorage so subsequent
 *     runs don't pester the user.
 *   - Returns a render-prop component the caller wraps around its Start
 *     Run button. The button is gated until the user taps "Got it".
 */

const STORAGE_KEY = "adaptivefit:bgLocationExplainerSeen";

export function useBackgroundLocationExplainer() {
  const [needsExplanation, setNeedsExplanation] = useState(false);

  useEffect(() => {
    // Only natives need this. Web users get the browser's own prompt.
    if (!isNativePlatform()) return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) setNeedsExplanation(true);
    } catch {
      // Private browsing / blocked storage — show the modal anyway. Worst
      // case is a returning user sees it twice; benign.
      setNeedsExplanation(true);
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setNeedsExplanation(false);
  };

  return { needsExplanation, dismiss };
}

export function BackgroundLocationExplainer({
  open,
  onAcknowledge,
}: {
  open: boolean;
  onAcknowledge: () => void;
}) {
  const t = useTranslations("run.bgExplainer");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-6 dark:bg-slate-900 sm:rounded-3xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl bg-blue-100 p-2 dark:bg-blue-900/30">
            <MapPin className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-lg font-bold tracking-tight">{t("title")}</h2>
        </div>

        <p className="mb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t("intro")}
        </p>

        <ul className="mb-6 space-y-3">
          <li className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-500" />
            <div>
              <p className="text-sm font-semibold">{t("permTitle")}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{t("permBody")}</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-500" />
            <div>
              <p className="text-sm font-semibold">{t("notifTitle")}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{t("notifBody")}</p>
            </div>
          </li>
        </ul>

        <button
          onClick={onAcknowledge}
          className="w-full rounded-2xl bg-blue-600 py-3.5 font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700"
        >
          {t("acknowledge")}
        </button>
      </div>
    </div>
  );
}
