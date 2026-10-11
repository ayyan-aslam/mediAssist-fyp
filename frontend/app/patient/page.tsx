import { HeartPulse } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

// The patient area is built in Phase 4.
export default function PatientHomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-4">
      <EmptyState className="w-full rounded-[1.75rem] border bg-card" icon={HeartPulse} title="Patient area" description="This area comes in Phase 4." />
    </main>
  );
}
