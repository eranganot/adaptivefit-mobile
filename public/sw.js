// AdaptiveFit service worker — v4
// Strategy:
//   - _next/static/** (immutable hashed bundles) → CacheFirst, long-lived cache
//   - manifest.json only             → CacheFirst shell precache (auth routes removed)
//   - API + auth routes             → NetworkOnly (skip SW)
//   - Everything else               → NetworkFirst with cache fallback
//
// v3 change: auth-protected pages (/home, /roadmap, /analytics, /settings) removed
// from SHELL_PRECACHE. They were being cached at install time (unauthenticated,
// pre-theme-script) and falling back to that stale shell on hard refresh, causing
// the whole app to render in light mode. They will be cached on first online visit
// via the existing NetworkFirst path instead.
//
// v4 change: eagerly-clone responses BEFORE kicking off the async cache write
// in the NetworkFirst branch. Previously, `caches.open(...).then(cache =>
// cache.put(req, res.clone()))` deferred the clone until AFTER caches.open
// resolved — by which time `return res` had already handed the body to the
// browser, the body was locked, and `res.clone()` threw "Response body is
// already used" on every navigation request. Loud in logcat, harmless to
// functionality, but worth killing.
//
// Bump cache names so the new SW activates cleanly and old buggy caches are
// evicted on first visit after deploy.

const SHELL_CACHE = "af-shell-v4";
const STATIC_CACHE = "af-static-v3";
const SHELL_PRECACHE = ["/manifest.json"];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

// ── Activate — evict old caches ──────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const KEEP = [SHELL_CACHE, STATIC_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // NetworkOnly: API, auth, Next.js internal, cross-origin
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/_next/data/")
  ) {
    return; // browser handles normally
  }

  // CacheFirst: immutable Next.js static assets (_next/static/**)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }),
    );
    return;
  }

  // NetworkFirst: navigation + other GET requests
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          // Clone EAGERLY while res.body is still untouched. The deferred
          // caches.open chain runs later, by which time `return res` has
          // handed the body to the browser stream. If we clone inside the
          // deferred `.then((cache) => …)`, the body is already locked
          // and clone() throws — the source of the "Response body is
          // already used" console spam in v3.
          const resClone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, resClone));
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
