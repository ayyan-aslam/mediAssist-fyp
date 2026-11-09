import { Suspense } from "react";
import type { Metadata } from "next";
import { PatientHistory } from "./patient-history";

export const metadata: Metadata = { title: "Patient" };

// Suspense: the edit form reads ?edit= and ?note= from the URL.
export default function PatientPage() {
  return (
    <Suspense>
      <PatientHistory />
    </Suspense>
  );
}
