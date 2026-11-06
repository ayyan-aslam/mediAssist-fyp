import { Suspense } from "react";
import type { Metadata } from "next";
import { RedirectIfAuthenticated } from "@/components/shared/redirect-if-authenticated";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

// LoginForm reads ?next= and ?verified= from the URL, so it renders inside Suspense.
export default function LoginPage() {
  return (
    <>
      <RedirectIfAuthenticated />
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
