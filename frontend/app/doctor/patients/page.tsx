import { Suspense } from "react";
import type { Metadata } from "next";
import { PatientsList } from "./patients-list";

export const metadata: Metadata = { title: "Patients & notes" };

// Suspense: the search box reads ?q= from the URL.
export default function PatientsPage() {
  return (
    <Suspense>
      <PatientsList />
    </Suspense>
  );
}
