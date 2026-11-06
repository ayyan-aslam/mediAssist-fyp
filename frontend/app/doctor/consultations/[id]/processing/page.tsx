import type { Metadata } from "next";
import { ProcessingScreen } from "./processing-screen";

export const metadata: Metadata = { title: "Preparing note" };

export default function ProcessingPage() {
  return <ProcessingScreen />;
}
