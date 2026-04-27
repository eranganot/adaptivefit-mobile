import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // PWA manifest is served from /public; service worker registered on the client
  // (see app/layout.tsx). Avoiding next-pwa for now to keep config simple.
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
