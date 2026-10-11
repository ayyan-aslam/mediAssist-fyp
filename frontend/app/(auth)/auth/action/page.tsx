import { Suspense } from "react";
import type { Metadata } from "next";
import { EmailAction } from "./email-action";

export const metadata: Metadata = { title: "Account" };

// The links in the Firebase emails (verify email, reset password) open this page.
// Set it as the custom action URL in the Firebase console (see README).
export default function EmailActionPage() {
  return (
    <Suspense>
      <EmailAction />
    </Suspense>
  );
}
