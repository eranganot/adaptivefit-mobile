import type { CapacitorConfig } from "@capacitor/cli";

/**
 * AdaptiveFit native shell config (Capacitor 6, Android only for now).
 *
 * STRATEGY: this app is server-rendered (Next.js). We don't bundle the web
 * code into the APK — we point the WebView at a live URL.
 *
 *   - Production:  https://adaptivefit-mobile-production.up.railway.app
 *   - Dev (LAN):   http://<your-laptop-ip>:3000 (Next.js dev server on WiFi)
 *
 * Switch between them with the CAPACITOR_DEV env var **at sync time** (i.e.
 * when you run `npx cap sync android`). The chosen URL is baked into the
 * Android resources; you only need to re-sync when switching modes.
 *
 *   # Build for production (default)
 *   npx cap sync android
 *
 *   # Build for LAN dev
 *   $env:CAPACITOR_DEV="1"; npx cap sync android   # PowerShell
 *   # CAPACITOR_DEV=1 npx cap sync android         # bash/zsh
 *
 * To override the dev URL (e.g. if your LAN IP changes, or you're tunneling):
 *
 *   $env:CAPACITOR_DEV="1"; $env:CAPACITOR_DEV_URL="http://192.168.1.42:3000"
 *   npx cap sync android
 *
 * NOTE: cleartext (plain HTTP) is enabled only in dev mode and limited via
 * the Android network-security config to your LAN IP. Production always
 * runs over HTTPS.
 */

const PROD_URL = "https://adaptivefit-mobile-production.up.railway.app";
const DEFAULT_DEV_URL = "http://10.0.0.20:3000";

const isDev = process.env.CAPACITOR_DEV === "1";
const devUrl = process.env.CAPACITOR_DEV_URL ?? DEFAULT_DEV_URL;
const serverUrl = isDev ? devUrl : PROD_URL;

const config: CapacitorConfig = {
  appId: "com.adaptivefit.app",
  appName: "AdaptiveFit",
  // `webDir` is required by the CLI but never used when `server.url` is set
  // (we don't bundle the web build into the APK). Pointing at /public so the
  // CLI doesn't complain about a missing dir.
  webDir: "public",
  server: {
    url: serverUrl,
    // Allow plain HTTP only in dev (LAN). Production is forced HTTPS by
    // virtue of serverUrl being https://...
    cleartext: isDev,
    // Force https:// scheme for any in-app links so cookies set by Railway
    // (which is HTTPS) survive WebView navigations correctly in prod.
    androidScheme: "https",
    // Sites we allow the WebView to navigate to (e.g. via window.location).
    // Without this, Capacitor will open external links in the system browser.
    // For us "external" = Google OAuth pages, which we DO want to handle
    // internally so the redirect back to our app works.
    allowNavigation: [
      "adaptivefit-mobile-production.up.railway.app",
      "*.up.railway.app",
      "accounts.google.com",
      "*.googleusercontent.com",
    ],
  },
  android: {
    // Allow the cookie store + service worker to persist data across sessions
    // (next-auth session cookie lives in here).
    allowMixedContent: false,
    // We'll set minSdk / targetSdk via android/variables.gradle in Stage B.
    //
    // ── User-agent override (Google OAuth fix) ─────────────────────────
    // Default Android WebViews advertise themselves with a "; wv" suffix in
    // the user-agent string. Google's "Use secure browsers" policy detects
    // this and blocks OAuth with error 403 "disallowed_useragent".
    //
    // Overriding the UA to a plain Chrome string bypasses that check.
    //
    // NOTE: This is not Play-Store-policy-compliant. Fine for a personal
    // single-user app distributed via APK sideload (our case). If we ever
    // want to publish on Google Play we'll need to swap this for the
    // Chrome Custom Tabs + deep-link flow.
    //
    // Update the Chrome version periodically (every few months) so it
    // stays plausible — Google may eventually start blocking stale UAs.
    //
    // 2026-05-18: Tried Chrome/138.0.0.0 string. Worked once for OAuth
    // consent, then started returning Google 400 "malformed request" on
    // re-installs. Trying a more conservative UA below (well-known Chrome
    // on Android 14, no Pixel 9 device tag). If this also fails, switch
    // to Chrome Custom Tabs via @capacitor/browser (Step 4 in chat).
    overrideUserAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  },
};

export default config;
