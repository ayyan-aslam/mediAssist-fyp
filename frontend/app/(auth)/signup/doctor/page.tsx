import type { Metadata } from "next";
import { RedirectIfAuthenticated } from "@/components/shared/redirect-if-authenticated";
import { DoctorSignupForm } from "./doctor-signup-form";

export const metadata: Metadata = { title: "Doctor sign-up" };

export default function DoctorSignupPage() {
  return (
    <>
      <RedirectIfAuthenticated />
      <DoctorSignupForm />
    </>
  );
}
