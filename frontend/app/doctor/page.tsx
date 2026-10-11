"use client";

import { ArrowRight, FileSearch, FileText, Mic, UserRoundPlus, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageTransition } from "@/components/shared/page-transition";
import { Waveform } from "@/components/shared/product-previews";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// Phase 0 placeholder: the real actions, numbers and lists come with the Consultation Service (Phase 1).
const ACTIONS = [
  { icon: UserRoundPlus, title: "Add a patient", text: "Name, age, gender and phone.", tone: "bg-mint text-mint-foreground" },
  { icon: FileSearch, title: "Search SOAP notes", text: "By patient name or phone.", tone: "bg-sky text-sky-foreground" },
];

const STATS = [
  { icon: Users, label: "Patients" },
  { icon: Mic, label: "Consultations this week" },
  { icon: FileText, label: "Prescriptions sent" },
];

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DoctorHomePage() {
  const { user } = useAuth();
  const now = new Date();
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <PageTransition className="space-y-8">
      <div className="space-y-2">
        <p className="font-medium text-muted-foreground">{today}</p>
        <h1 className="font-display text-[2.1rem] leading-[1.08] font-extrabold tracking-[-0.03em] sm:text-[2.75rem]">
          {greeting(now.getHours())}
          <span className="block text-primary">{user?.fullName}</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr_1fr]">
        <Reveal className="flex flex-col justify-between gap-8 rounded-[1.75rem] bg-navy p-7 text-navy-foreground sm:p-8 dark:ring-1 dark:ring-navy-border">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-brand-bright">Next step</p>
              <Waveform className="[&>span]:bg-brand-bright" />
            </div>
            <h2 className="font-display text-3xl leading-tight font-extrabold tracking-[-0.03em] sm:text-4xl">
              Start a consultation
            </h2>
            <p className="max-w-md leading-relaxed text-navy-muted">
              Enter the patient’s details and press record. The SOAP note is ready about 15 seconds after you stop.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled size="lg" className="bg-brand-bright text-navy hover:bg-brand-bright disabled:opacity-70">
              Start consultation
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">Coming soon</span>
          </div>
        </Reveal>

        {ACTIONS.map(({ icon: Icon, title, text, tone }, index) => (
          <Reveal
            key={title}
            delay={0.05 + index * 0.05}
            className={cn("flex min-h-52 flex-col justify-between rounded-[1.75rem] p-7", tone)}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-current/10">
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <span className="rounded-full bg-current/10 px-2.5 py-1 text-xs font-semibold">Soon</span>
            </div>
            <div>
              <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em]">{title}</h2>
              <p className="mt-1 opacity-80">{text}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STATS.map(({ icon: Icon, label }, index) => (
          <Reveal key={label} delay={index * 0.05} className="rounded-[1.5rem] border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-muted-foreground">{label}</p>
              <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
            </div>
            <p className="mt-6 font-display text-4xl font-extrabold tracking-tight text-muted-foreground/50">—</p>
            <p className="mt-1 text-sm text-muted-foreground">No data yet</p>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1} className="overflow-hidden rounded-[1.5rem] border bg-card">
        <div className="flex items-center justify-between gap-4 border-b px-6 py-5">
          <h2 className="font-display text-lg font-bold tracking-tight">Recent consultations</h2>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">0 total</span>
        </div>
        <div className="hidden grid-cols-[1.5fr_1fr_1fr] gap-4 border-b bg-muted px-6 py-3 text-sm font-medium text-muted-foreground sm:grid">
          <span>Patient</span>
          <span>Date</span>
          <span>Status</span>
        </div>
        <EmptyState
          icon={Mic}
          title="No consultations yet"
          description="Your consultations and their SOAP notes will be listed here, newest first."
        />
      </Reveal>
    </PageTransition>
  );
}
