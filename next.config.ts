import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // PWA: manifest served from /public/manifest.json; service worker at /public/sw.js.
  // sw.js uses a two-cache strategy: CacheFirst for immutable _next/static assets,
  // NetworkFirst with fallback for navigation. Cache names include -v2 for this deploy.
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
