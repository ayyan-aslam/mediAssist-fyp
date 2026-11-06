import type { NextConfig } from "next";

// Where /api/v1/* is sent (see rewrites below). Read by the Next.js server only, never by the browser.
const gatewayUrl = (process.env.GATEWAY_URL || "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // The browser calls /api/v1/* on the web app itself and Next.js passes it on to the API Gateway.
  // So no CORS is needed, and a phone on the same Wi-Fi can use the app through this computer.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${gatewayUrl}/api/v1/:path*` }];
  },
  // Hide the Next.js dev tools button (bottom left in `npm run dev`). Errors still show.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The app areas render after the client-side auth guard has restored the session,
    // so only pages that opt in with `export const instant` are checked for instant navigation.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
