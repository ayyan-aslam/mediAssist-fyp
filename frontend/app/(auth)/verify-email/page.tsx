import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmail } from "./verify-email";

export const metadata: Metadata = { title: "Check your email" };

// VerifyEmail reads ?email= from the URL, so it renders inside Suspense.
export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
