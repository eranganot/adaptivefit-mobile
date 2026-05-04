// AdaptiveFit service worker — v2
// Strategy:
//   - _next/static/** (immutable hashed bundles) → CacheFirst, long-lived cache
//   - manifest.json, icons          → CacheFirst, shell cache
//   - API + auth routes             → NetworkOnly (skip SW)
//   - Everything else               → NetworkFirst with cache fallback

const SHELL_CACHE = "af-shell-v2";
const STATIC_CACHE = "af-static-v2";
const SHELL_PRECACHE = ["/", "/home", "/roadmap", "/analytics", "/settings", "/manifest.json"];

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
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
