"use client";

import { useEffect, useState } from "react";
import { BatteryWarning, X } from "lucide-react";

/**
 * Shown once per session when navigator.wakeLock is unavailable.
 * Instructs the user to keep the screen on manually (Pixel 9 / Android).
 */
export default function BatterySaverModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if wakeLock API is missing AND we haven't shown it this session
    const alreadyShown = sessionStorage.getItem("batterySaverDismissed");
    if (!alreadyShown && !("wakeLock" in navigator)) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    sessionStorage.setItem("batterySaverDismissed", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <button
          onClick={dismiss}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          aria-label="Dismiss"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <BatteryWarning className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Keep screen on during your run
            </p>
            <p className="text-xs text-muted-foreground">
              Screen lock may pause GPS tracking
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400 mb-5">
          Your device doesn&apos;t support automatic screen-on. To avoid GPS gaps,
          disable battery optimisation for this app or keep the screen unlocked
          while running.
        </p>

        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-5">
          <p className="font-medium text-slate-900 dark:text-slate-100">On Pixel / Android:</p>
          <ol className="list-decimal list-inside space-y-1 ps-1">
            <li>Settings → Apps → AdaptiveFit</li>
            <li>Battery → Unrestricted</li>
          </ol>
        </div>

        <button
          onClick={dismiss}
          className="w-full rounded-2xl bg-slate-900 py-3 font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Got it, continue
        </button>
      </div>
    </div>
  );
}
