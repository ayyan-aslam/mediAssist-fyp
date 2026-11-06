import type { Metadata } from "next";
import { NoteScreen } from "./note-screen";

export const metadata: Metadata = { title: "SOAP note" };

export default function NotePage() {
  return <NoteScreen />;
}
