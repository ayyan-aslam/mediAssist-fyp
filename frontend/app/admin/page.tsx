import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

// The admin area is built in Phase 3.
export default function AdminHomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-4">
      <EmptyState className="w-full rounded-[1.75rem] border bg-card" icon={ShieldCheck} title="Admin area" description="This area comes in Phase 3." />
    </main>
  );
}
