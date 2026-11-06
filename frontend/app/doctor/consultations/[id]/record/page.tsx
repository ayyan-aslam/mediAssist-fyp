import type { Metadata } from "next";
import { RecordScreen } from "./record-screen";

export const metadata: Metadata = { title: "Recording" };

export default function RecordPage() {
  return <RecordScreen />;
}
