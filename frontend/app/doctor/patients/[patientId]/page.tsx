import type { Metadata } from "next";
import { PatientHistory } from "./patient-history";

export const metadata: Metadata = { title: "Patient" };

export default function PatientPage() {
  return <PatientHistory />;
}
