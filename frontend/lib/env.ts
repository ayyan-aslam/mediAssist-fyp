import { z } from "zod";

// Public settings, checked once when the app starts.
// Next.js inlines NEXT_PUBLIC_* values only when they are read by their full name,
// so each one is listed here by hand.
const schema = z
  .object({
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_USE_MOCKS: z.enum(["true", "false"]).default("false"),
    NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_APP_ID: z.string().optional(),
  })
  .refine(
    (env) =>
      env.NEXT_PUBLIC_USE_MOCKS === "true" ||
      (env.NEXT_PUBLIC_FIREBASE_API_KEY &&
        env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
        env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
        env.NEXT_PUBLIC_FIREBASE_APP_ID),
    { message: "The NEXT_PUBLIC_FIREBASE_* settings are required when NEXT_PUBLIC_USE_MOCKS is not true." },
  );

const parsed = schema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_USE_MOCKS: process.env.NEXT_PUBLIC_USE_MOCKS || undefined,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || undefined,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || undefined,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || undefined,
});

if (!parsed.success) {
  throw new Error(
    `Invalid frontend settings. Check frontend/.env.local (see .env.example).\n${z.prettifyError(parsed.error)}`,
  );
}

export const env = {
  apiUrl: parsed.data.NEXT_PUBLIC_API_URL.replace(/\/$/, ""),
  useMocks: parsed.data.NEXT_PUBLIC_USE_MOCKS === "true",
  firebase: {
    apiKey: parsed.data.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: parsed.data.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: parsed.data.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: parsed.data.NEXT_PUBLIC_FIREBASE_APP_ID,
  },
};
