"use client";

/**
 * Geolocation abstraction — single API that uses the right implementation
 * depending on where the code is running:
 *
 *   - Inside Capacitor on native Android:
 *       @capacitor-community/background-geolocation
 *       (foreground-service-backed; survives screen lock / app background /
 *       app kill from recents)
 *
 *   - In a regular browser (PWA, desktop, web dev):
 *       navigator.geolocation.watchPosition
 *       (foreground only — stops when tab is backgrounded; the Phase-1
 *       IndexedDB persistence + page-reopen restore is what saves us)
 *
 * The tracker hook calls `watchPosition()` here and doesn't care which one
 * is used. Same callback signature, same point shape, same stop() method.
 *
 * For Phase 4 the native path is the one that fixes the user's three
 * original issues (lock screen, browser exit, app kill).
 */

import type { GpsRawPoint } from "./haversine";

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

export type GeoWatcher = {
  /** Stop watching. Idempotent. */
  stop: () => Promise<void>;
};

export type GeoWatchOptions = {
  /** Title shown in the persistent notification when running native + background. */
  backgroundTitle?: string;
  /** Body text shown in the persistent notification. */
  backgroundMessage?: string;
  /**
   * Minimum distance (m) between location reports. 0 = report every fix.
   * On native, used as the plugin's `distanceFilter`. Ignored on web.
   */
  distanceFilterM?: number;
};

export type GeoErrorCode =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "not_supported"
  | "unknown";

export type GeoError = {
  code: GeoErrorCode;
  message: string;
};

// ─────────────────────────────────────────────────────────────────
// Platform detection — kept tiny so it tree-shakes cleanly on web
// ─────────────────────────────────────────────────────────────────

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  // `Capacitor` is injected on the window object by the native shell.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
}

// ─────────────────────────────────────────────────────────────────
// Web implementation — navigator.geolocation.watchPosition
// ─────────────────────────────────────────────────────────────────

function startWebWatcher(
  onLocation: (p: GpsRawPoint) => void,
  onError: (e: GeoError) => void,
): GeoWatcher {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onError({ code: "not_supported", message: "Geolocation not supported on this device." });
    return { stop: async () => {} };
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onLocation({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        ts: pos.timestamp,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude ?? undefined,
      });
    },
    (err) => {
      const code: GeoErrorCode =
        err.code === err.PERMISSION_DENIED
          ? "permission_denied"
          : err.code === err.POSITION_UNAVAILABLE
            ? "position_unavailable"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unknown";
      onError({ code, message: err.message || "GPS error" });
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
  );

  return {
    stop: async () => {
      navigator.geolocation.clearWatch(watchId);
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Native implementation — @capacitor-community/background-geolocation
// Loaded lazily so the web bundle never imports the native module.
// ─────────────────────────────────────────────────────────────────

/** Shape of a single location event emitted by the native plugin. */
type NativeLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  simulated: boolean;
  speed: number | null;
  bearing: number | null;
  time: number | null;
};

/** Shape of an error reported by the native plugin's watcher callback. */
type NativeWatcherError = {
  code?: string;
  message?: string;
};

/** Minimal subset of the plugin's API surface that we actually use. */
type BackgroundGeolocationApi = {
  addWatcher(
    config: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (
      location: NativeLocation | null,
      error?: NativeWatcherError,
    ) => void,
  ): Promise<string>;
  removeWatcher(opts: { id: string }): Promise<void>;
};

async function startNativeWatcher(
  onLocation: (p: GpsRawPoint) => void,
  onError: (e: GeoError) => void,
  opts: GeoWatchOptions,
): Promise<GeoWatcher> {
  // Dynamic import keeps the native plugin out of the web bundle. Different
  // versions of the plugin expose the proxy as either a named export
  // (`BackgroundGeolocation`) or as `default`. We read both and cast through
  // a known interface so TypeScript is happy regardless of the .d.ts shape
  // shipped by the version we end up with.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import("@capacitor-community/background-geolocation")) as any;
  const BackgroundGeolocation: BackgroundGeolocationApi =
    mod.BackgroundGeolocation ?? mod.default;

  let watcherId: string | null = null;

  try {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        // Setting backgroundMessage starts the Android foreground service —
        // this is what keeps GPS callbacks firing when the screen locks /
        // app is backgrounded / app is killed from recents.
        backgroundMessage: opts.backgroundMessage ?? "Tracking your run",
        backgroundTitle: opts.backgroundTitle ?? "AdaptiveFit",
        // Prompts the user for foreground + background location permissions.
        // The plugin handles the Android 11+ two-step request internally.
        requestPermissions: true,
        // If true, the first emitted location may be a cached (potentially
        // stale) value. We want only fresh fixes.
        stale: false,
        // Meters of movement before another update is emitted. 0 = no filter
        // (raw stream). We do our own filtering in isPointValid().
        distanceFilter: opts.distanceFilterM ?? 0,
      },
      (location: NativeLocation | null, error?: NativeWatcherError) => {
        if (error) {
          // Common errors from the plugin: "Permission denied", "Location services disabled"
          const msg = error.message ?? String(error);
          const code: GeoErrorCode =
            /permission/i.test(msg) ? "permission_denied"
            : /unavailable|disabled/i.test(msg) ? "position_unavailable"
            : "unknown";
          onError({ code, message: msg });
          return;
        }
        if (!location) return;
        onLocation({
          lat: location.latitude,
          lon: location.longitude,
          ts: typeof location.time === "number" ? location.time : Date.now(),
          accuracy: location.accuracy ?? 999,
          altitude: location.altitude ?? undefined,
        });
      },
    );
  } catch (e) {
    onError({
      code: "unknown",
      message: e instanceof Error ? e.message : "Failed to start background tracker",
    });
    return { stop: async () => {} };
  }

  return {
    stop: async () => {
      if (watcherId != null) {
        try {
          await BackgroundGeolocation.removeWatcher({ id: watcherId });
        } catch {
          /* watcher may already be removed (e.g., when the OS killed our process) */
        }
        watcherId = null;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Start watching the user's position. Returns a watcher with a `stop()`
 * method. Always call `stop()` when the run ends so the foreground service
 * notification is dismissed and the GPS chip can power down.
 *
 * The native path requires user-granted runtime permissions, which the
 * plugin requests on first call. If the user denies background location
 * the watcher still works in foreground only (screen-on); we report a
 * non-fatal `permission_denied` error so the UI can prompt them.
 */
export async function watchPosition(
  onLocation: (p: GpsRawPoint) => void,
  onError: (e: GeoError) => void,
  opts: GeoWatchOptions = {},
): Promise<GeoWatcher> {
  if (isNative()) {
    return startNativeWatcher(onLocation, onError, opts);
  }
  return startWebWatcher(onLocation, onError);
}

/** True iff we're running inside the Capacitor native shell. */
export function isNativePlatform(): boolean {
  return isNative();
}
