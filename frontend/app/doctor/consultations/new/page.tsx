import type { Metadata } from "next";
import { NewConsultation } from "./new-consultation";

export const metadata: Metadata = { title: "New consultation" };

export default function NewConsultationPage() {
  return <NewConsultation />;
}
