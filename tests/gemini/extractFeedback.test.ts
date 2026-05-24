/**
 * Schema-level tests for extractFeedback.
 *
 * We don't mock Gemini's full I/O — that's an integration concern. What we
 * pin here is the ExtractionSchema shape, especially the Phase 8b.4
 * `extracted_distance_km` / `extracted_duration_sec` fields: if Gemini ever
 * returns a malformed value (negative, NaN, wildly out-of-range), the schema
 * must reject it cleanly so the back-fill in logManualWorkout never writes
 * corrupt distance/duration to workout_logs.
 */
import { describe, expect, it } from "vitest";
import { ExtractionSchema } from "@/lib/gemini/extractFeedback";

const BASE = {
  overall_sentiment: "neutral" as const,
  symptoms: [],
  severity: 0,
  ai_summary_en: "ok",
  ai_summary_he: "ok",
  detected_locale: "en" as const,
};

describe("ExtractionSchema — Phase 8b.4 run metric fields", () => {
  it("accepts both extracted metric fields as null", () => {
    const r = ExtractionSchema.parse({
      ...BASE,
      extracted_distance_km: null,
      extracted_duration_sec: null,
    });
    expect(r.extracted_distance_km).toBeNull();
    expect(r.extracted_duration_sec).toBeNull();
  });

  it("accepts a typical extraction: 7k in 45 min", () => {
    const r = ExtractionSchema.parse({
      ...BASE,
      extracted_distance_km: 7,
      extracted_duration_sec: 2700,
    });
    expect(r.extracted_distance_km).toBe(7);
    expect(r.extracted_duration_sec).toBe(2700);
  });

  it("accepts mile-converted distance (5 miles → 8.05 km)", () => {
    const r = ExtractionSchema.parse({
      ...BASE,
      extracted_distance_km: 8.05,
      extracted_duration_sec: null,
    });
    expect(r.extracted_distance_km).toBeCloseTo(8.05);
  });

  it("rejects negative distance — Gemini hallucination guard", () => {
    expect(() =>
      ExtractionSchema.parse({
        ...BASE,
        extracted_distance_km: -1,
        extracted_duration_sec: null,
      }),
    ).toThrow();
  });

  it("rejects zero distance (positive only)", () => {
    // Zero distance with a duration would imply infinite pace — refuse it
    // at the schema layer rather than letting it through to a DB update.
    expect(() =>
      ExtractionSchema.parse({
        ...BASE,
        extracted_distance_km: 0,
        extracted_duration_sec: 2700,
      }),
    ).toThrow();
  });

  it("rejects nonsense distance (>500 km in a single workout)", () => {
    // Bounds chosen to comfortably cover ultra-marathons (~270 km Western
    // States winners) while flagging an obvious hallucination as invalid.
    expect(() =>
      ExtractionSchema.parse({
        ...BASE,
        extracted_distance_km: 1000,
        extracted_duration_sec: null,
      }),
    ).toThrow();
  });

  it("rejects negative duration", () => {
    expect(() =>
      ExtractionSchema.parse({
        ...BASE,
        extracted_distance_km: null,
        extracted_duration_sec: -100,
      }),
    ).toThrow();
  });

  it("rejects duration > 24h (suspect hallucination on a daily session)", () => {
    expect(() =>
      ExtractionSchema.parse({
        ...BASE,
        extracted_distance_km: null,
        extracted_duration_sec: 86401, // 24h + 1s
      }),
    ).toThrow();
  });

  it("rejects non-integer duration_sec", () => {
    expect(() =>
      ExtractionSchema.parse({
        ...BASE,
        extracted_distance_km: null,
        extracted_duration_sec: 1800.5,
      }),
    ).toThrow();
  });

  it("rejects missing fields — must be present in every Gemini response", () => {
    // Without these in the output, the schema-level guard is the only thing
    // standing between Gemini and a write. Parse must reject the legacy
    // shape outright so old code paths can't silently drop the fields.
    expect(() => ExtractionSchema.parse({ ...BASE })).toThrow();
  });
});
