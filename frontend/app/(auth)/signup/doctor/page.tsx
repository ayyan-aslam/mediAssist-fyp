import type { Metadata } from "next";
import { DoctorSignupForm } from "./doctor-signup-form";

export const metadata: Metadata = { title: "Doctor sign-up" };

export default function DoctorSignupPage() {
  return <DoctorSignupForm />;
}
