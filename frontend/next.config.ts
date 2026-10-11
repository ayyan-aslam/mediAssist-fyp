import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
