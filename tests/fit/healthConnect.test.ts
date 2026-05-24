/**
 * Health Connect permission-matching unit tests.
 *
 * Pin the contract of the permission normalizer + matcher so we don't
 * regress the false-negative bug fixed in Phase 8b.2:
 *
 *   The plugin sometimes returns granted perms as short type names
 *   ("Steps") and sometimes as fully-qualified Android permission strings
 *   ("android.permission.health.READ_ACTIVE_CALORIES_BURNED"). The
 *   previous matcher used naive `lower.includes(target)` which works for
 *   single-word types ("steps" ⊂ "read_steps") but FAILS for multi-word
 *   types ("activecaloriesburned" is NOT a substring of
 *   "read_active_calories_burned" because of the underscores).
 *
 *   Result: Steps + Distance passed, Active/TotalCalories always failed,
 *   producing a false "Permission denied" even when the OS reported all
 *   four as granted (confirmed via on-device screenshot 2026-05-24).
 *
 * These tests pin both the exact normalization and the cross-shape
 * matcher behavior so the bug can't quietly come back.
 */
import { describe, expect, it } from "vitest";
import {
  buildPermissionResult,
  isPermissionGranted,
  normalizePermissionString,
} from "@/lib/fit/healthConnect";

describe("normalizePermissionString", () => {
  it("lowercases", () => {
    expect(normalizePermissionString("Steps")).toBe("steps");
  });

  it("strips underscores", () => {
    expect(normalizePermissionString("READ_ACTIVE_CALORIES_BURNED")).toBe(
      "readactivecaloriesburned",
    );
  });

  it("strips dots and other separators in fully-qualified names", () => {
    expect(
      normalizePermissionString(
        "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
      ),
    ).toBe("androidpermissionhealthreadactivecaloriesburned");
  });

  it("is idempotent on already-normalized strings", () => {
    const once = normalizePermissionString("Active_Calories_Burned");
    const twice = normalizePermissionString(once);
    expect(once).toBe(twice);
  });
});

describe("isPermissionGranted — single-word types", () => {
  it("matches Steps in short form", () => {
    expect(isPermissionGranted("Steps", ["Steps"])).toBe(true);
  });

  it("matches Steps in qualified form", () => {
    expect(
      isPermissionGranted("Steps", ["android.permission.health.READ_STEPS"]),
    ).toBe(true);
  });

  it("matches Distance in qualified form", () => {
    expect(
      isPermissionGranted("Distance", [
        "android.permission.health.READ_DISTANCE",
      ]),
    ).toBe(true);
  });

  it("returns false when permission isn't in the granted list", () => {
    expect(isPermissionGranted("Distance", ["Steps"])).toBe(false);
  });

  it("returns false for empty granted array", () => {
    expect(isPermissionGranted("Steps", [])).toBe(false);
  });
});

describe("isPermissionGranted — multi-word types (the bug)", () => {
  // These are the exact cases the old matcher silently failed on.
  it("matches ActiveCaloriesBurned in qualified form", () => {
    expect(
      isPermissionGranted("ActiveCaloriesBurned", [
        "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
      ]),
    ).toBe(true);
  });

  it("matches TotalCaloriesBurned in qualified form", () => {
    expect(
      isPermissionGranted("TotalCaloriesBurned", [
        "android.permission.health.READ_TOTAL_CALORIES_BURNED",
      ]),
    ).toBe(true);
  });

  it("matches ActiveCaloriesBurned in bare READ_ form (no android.permission prefix)", () => {
    expect(
      isPermissionGranted("ActiveCaloriesBurned", [
        "READ_ACTIVE_CALORIES_BURNED",
      ]),
    ).toBe(true);
  });

  it("matches ActiveCaloriesBurned in short form", () => {
    expect(
      isPermissionGranted("ActiveCaloriesBurned", ["ActiveCaloriesBurned"]),
    ).toBe(true);
  });

  it("matches all four required types when plugin returns mixed shapes", () => {
    // Realistic worst-case: plugin returns some short, some qualified.
    const granted = [
      "Steps",
      "android.permission.health.READ_DISTANCE",
      "READ_ACTIVE_CALORIES_BURNED",
      "TotalCaloriesBurned",
    ];
    expect(isPermissionGranted("Steps", granted)).toBe(true);
    expect(isPermissionGranted("Distance", granted)).toBe(true);
    expect(isPermissionGranted("ActiveCaloriesBurned", granted)).toBe(true);
    expect(isPermissionGranted("TotalCaloriesBurned", granted)).toBe(true);
  });
});

describe("buildPermissionResult — trusts hasAllPermissions when present", () => {
  // The 8b.2 fix: plugin (kiwi-health ≥ 0.0.40) returns hasAllPermissions as
  // the authoritative signal. We should trust it even when grantedPermissions
  // is empty — which happens when HC has nothing to prompt for because all
  // permissions are already granted at the OS level. Real-device logcat
  // confirmed this exact case.
  it("hasAllPermissions:true with empty granted → allGranted:true", () => {
    const r = buildPermissionResult({
      grantedPermissions: [],
      hasAllPermissions: true,
    });
    expect(r.allGranted).toBe(true);
    expect(r.missing).toEqual([]);
    // ExerciseSession piggy-backs on allGranted when the plugin says true
    // (because hasAllPermissions covers everything we asked for, including
    // ExerciseSession if it was in HEALTH_READ_TYPES). This protects #3
    // from regressing on a no-prompt path.
    expect(r.hasExerciseSession).toBe(true);
  });

  it("hasAllPermissions:false with empty granted → allGranted:false", () => {
    const r = buildPermissionResult({
      grantedPermissions: [],
      hasAllPermissions: false,
    });
    expect(r.allGranted).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("hasAllPermissions:true overrides what string-matching would conclude", () => {
    // Real-world false-negative: granted list is empty (e.g. "no requestable
    // permission" path), but plugin tells us authoritatively that everything
    // is granted. Trust the plugin.
    const r = buildPermissionResult({
      grantedPermissions: [],
      hasAllPermissions: true,
    });
    expect(r.allGranted).toBe(true);
  });

  it("when hasAllPermissions is absent, falls back to string matching", () => {
    // Older plugin or unknown response shape — must still work via the
    // existing matcher.
    const r = buildPermissionResult({
      grantedPermissions: [
        "android.permission.health.READ_STEPS",
        "android.permission.health.READ_DISTANCE",
        "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
        "android.permission.health.READ_TOTAL_CALORIES_BURNED",
      ],
      // hasAllPermissions intentionally omitted
    });
    expect(r.allGranted).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("handles tolerant response shapes (readPermissions/granted/permissions keys)", () => {
    // Defensive: plugin variants have used different key names. Make sure
    // each shape still resolves correctly.
    const r1 = buildPermissionResult({ readPermissions: ["Steps", "Distance", "ActiveCaloriesBurned", "TotalCaloriesBurned"] });
    expect(r1.allGranted).toBe(true);
    const r2 = buildPermissionResult({ granted: ["Steps", "Distance", "ActiveCaloriesBurned", "TotalCaloriesBurned"] });
    expect(r2.allGranted).toBe(true);
    const r3 = buildPermissionResult({ permissions: ["Steps", "Distance", "ActiveCaloriesBurned", "TotalCaloriesBurned"] });
    expect(r3.allGranted).toBe(true);
  });

  it("returns the right missing types when partially granted", () => {
    const r = buildPermissionResult({
      grantedPermissions: ["Steps", "Distance"],
      hasAllPermissions: false,
    });
    expect(r.allGranted).toBe(false);
    expect(r.missing).toContain("ActiveCaloriesBurned");
    expect(r.missing).toContain("TotalCaloriesBurned");
    expect(r.missing).not.toContain("Steps");
    expect(r.missing).not.toContain("Distance");
  });

  it("null / undefined / non-object response → all-missing, not-granted", () => {
    // Plugin bridge can return null on a JNI-level error before the
    // promise rejects. Don't crash; treat as "none granted".
    expect(buildPermissionResult(null).allGranted).toBe(false);
    expect(buildPermissionResult(undefined).allGranted).toBe(false);
    expect(buildPermissionResult("oops").allGranted).toBe(false);
  });
});

describe("isPermissionGranted — ExerciseSession alias", () => {
  // Android maps ExerciseSession reads to the READ_EXERCISE permission, not
  // READ_EXERCISE_SESSION. Without the alias, normalize-and-substring would
  // miss the qualified form. Pin the alias here so a future refactor doesn't
  // drop it.
  it("matches ExerciseSession against READ_EXERCISE", () => {
    expect(
      isPermissionGranted("ExerciseSession", [
        "android.permission.health.READ_EXERCISE",
      ]),
    ).toBe(true);
  });

  it("matches ExerciseSession against bare READ_EXERCISE", () => {
    expect(
      isPermissionGranted("ExerciseSession", ["READ_EXERCISE"]),
    ).toBe(true);
  });

  it("matches ExerciseSession against short ExerciseSession form", () => {
    expect(
      isPermissionGranted("ExerciseSession", ["ExerciseSession"]),
    ).toBe(true);
  });

  it("does NOT match ExerciseSession against unrelated permission", () => {
    expect(isPermissionGranted("ExerciseSession", ["READ_STEPS"])).toBe(false);
  });
});
