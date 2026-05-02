/**
 * RTL / i18n parity tests.
 *
 * Goals:
 *   1. Every key present in en.json is also present in he.json (no missing strings).
 *   2. Hebrew values contain Hebrew characters (not accidentally left as English).
 *   3. All page-critical keys exist for Home, Roadmap, Analytics, and Settings.
 *   4. Interpolation placeholders ({name}, {week}, etc.) are preserved in HE translations.
 */
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import he from "@/messages/he.json";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect all dot-notation keys from a nested object */
function flatKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k;
    return typeof v === "object" && v !== null
      ? flatKeys(v as Record<string, unknown>, full)
      : [full];
  });
}

/** Get nested value by dot-notation key */
function getKey(obj: Record<string, unknown>, path: string): string | undefined {
  return path.split(".").reduce<unknown>((cur, seg) => {
    if (cur && typeof cur === "object") return (cur as Record<string, unknown>)[seg];
    return undefined;
  }, obj) as string | undefined;
}

const HEBREW_RE = /[\u0590-\u05FF]/; // Hebrew Unicode block

/** Extract {placeholder} tokens from a string */
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("i18n: HE has every key that EN has", () => {
  const enKeys = flatKeys(en as Record<string, unknown>);
  const heKeys = new Set(flatKeys(he as Record<string, unknown>));

  for (const key of enKeys) {
    it(`he.json has key: ${key}`, () => {
      expect(heKeys.has(key), `Missing in he.json: ${key}`).toBe(true);
    });
  }
});

describe("i18n: Hebrew values contain Hebrew characters", () => {
  // We check a representative sample of page-critical keys
  const CRITICAL_KEYS = [
    "home.greetingMorning",
    "home.greetingAfternoon",
    "home.greetingEvening",
    "home.startRun",
    "home.logManual",
    "roadmap.title",
    "roadmap.weekBadge",
    "analytics.title",
    "analytics.weeklyDistance",
    "analytics.avgRpe",
    "post.title",
    "post.rpeLabel",
    "post.submit",
    "settings.language",
  ];

  for (const key of CRITICAL_KEYS) {
    it(`he["${key}"] is in Hebrew`, () => {
      const val = getKey(he as Record<string, unknown>, key);
      expect(val, `Key not found in he.json: ${key}`).toBeDefined();
      expect(
        HEBREW_RE.test(val ?? ""),
        `Expected Hebrew characters in he["${key}"] but got: "${val}"`,
      ).toBe(true);
    });
  }
});

describe("i18n: placeholders preserved in HE translations", () => {
  const enKeys = flatKeys(en as Record<string, unknown>);

  for (const key of enKeys) {
    const enVal = getKey(en as Record<string, unknown>, key) ?? "";
    const enPlaceholders = placeholders(enVal);
    if (enPlaceholders.length === 0) continue;

    it(`he["${key}"] preserves placeholders: ${enPlaceholders.join(", ")}`, () => {
      const heVal = getKey(he as Record<string, unknown>, key) ?? "";
      const hePlaceholders = placeholders(heVal);
      for (const ph of enPlaceholders) {
        expect(
          hePlaceholders.includes(ph),
          `Placeholder {${ph}} missing in he["${key}"]: "${heVal}"`,
        ).toBe(true);
      }
    });
  }
});

describe("i18n: page-critical sections exist in both locales", () => {
  const SECTIONS = ["home", "roadmap", "analytics", "post", "settings", "done"];

  for (const section of SECTIONS) {
    it(`section "${section}" exists in en.json`, () => {
      expect((en as Record<string, unknown>)[section]).toBeDefined();
    });
    it(`section "${section}" exists in he.json`, () => {
      expect((he as Record<string, unknown>)[section]).toBeDefined();
    });
  }
});
