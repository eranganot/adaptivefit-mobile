"use client";

import { useEffect } from "react";

/**
 * Belt-and-suspenders theme guard.
 *
 * The primary theme initializer is the synchronous <script> in app/layout.tsx
 * that runs before first paint. But if a stale SW-cached shell without that
 * script slips through (e.g. old v2 cache before the v3 bump self-heals),
 * this effect catches it on hydration and applies the correct class.
 *
 * Cost: one localStorage read per navigation — negligible.
 */
export function ThemeGuard() {
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = saved === "dark" || (!saved && prefersDark);
    const html = document.documentElement;

    if (shouldBeDark && !html.classList.contains("dark")) {
      html.classList.add("dark");
    } else if (!shouldBeDark && html.classList.contains("dark")) {
      html.classList.remove("dark");
    }
  }, []);

  return null;
}
