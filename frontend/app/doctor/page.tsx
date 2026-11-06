"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, CircleAlert, FileSearch, FileText, Mic, RotateCw, UserRoundPlus, Users } from "lucide-react";
import { ConsultationStatusChip } from "@/components/shared/consultation-status";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { NEW_CONSULTATION_HREF } from "@/components/shared/nav-config";
import { PageTransition } from "@/components/shared/page-transition";
import { Waveform } from "@/components/shared/product-previews";
import { Reveal } from "@/components/shared/reveal";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { consultationsApi, recentSoapNotesQueryKey } from "@/lib/api/consultations";
import type { SoapNoteListItem } from "@/lib/api/types";
import { formatDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

// Tiles without an href are not built yet and show a "Soon" chip. The numbers come later.
const ACTIONS: { icon: typeof Mic; title: string; text: string; tone: string; href?: string }[] = [
  { icon: UserRoundPlus, title: "Add a patient", text: "Name, age, gender and phone.", tone: "bg-mint text-mint-foreground" },
  {
    icon: FileSearch,
    title: "Search SOAP notes",
    text: "By patient name or phone.",
    tone: "bg-sky text-sky-foreground",
    href: "/doctor/search",
  },
];

const STATS = [
  { icon: Users, label: "Patients" },
  { icon: Mic, label: "Consultations this week" },
  { icon: FileText, label: "Prescriptions sent" },
];

const RECENT_NOTES = 5;
const COLUMNS = "sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_1.25rem]";

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
            <Button asChild size="lg" className="bg-brand-bright text-navy hover:bg-[color-mix(in_oklch,var(--brand-bright),white_12%)]">
              <Link href={NEW_CONSULTATION_HREF}>
                Start consultation
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </Reveal>

        {ACTIONS.map(({ icon: Icon, title, text, tone, href }, index) => {
          const tileClass = cn("flex min-h-52 flex-col justify-between rounded-[1.75rem] p-7", tone);
          const tile = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-current/10">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                {!href && <span className="rounded-full bg-current/10 px-2.5 py-1 text-xs font-semibold">Soon</span>}
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em]">{title}</h2>
                  <p className="mt-1 opacity-80">{text}</p>
                </div>
                {href && (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-current/10">
                    <ArrowRight aria-hidden="true" className="size-5" />
                  </span>
                )}
              </div>
            </>
          );
          return href ? (
            <Reveal key={title} delay={0.05 + index * 0.05} className="flex">
              <Link
                href={href}
                className={cn(
                  tileClass,
                  "w-full transition-transform outline-none hover:-translate-y-1 focus-visible:ring-4 focus-visible:ring-ring/30",
                )}
              >
                {tile}
              </Link>
            </Reveal>
          ) : (
            <Reveal key={title} delay={0.05 + index * 0.05} className={tileClass}>
              {tile}
            </Reveal>
          );
        })}
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

      <RecentNotes />
    </PageTransition>
  );
}

// The doctor's latest SOAP notes (GET /soap-notes).
function RecentNotes() {
  const notes = useQuery({
    queryKey: recentSoapNotesQueryKey,
    queryFn: () => consultationsApi.listRecentSoapNotes(RECENT_NOTES),
  });

  let body: React.ReactNode;
  if (notes.isPending) {
    body = <ListSkeleton rows={3} />;
  } else if (notes.isError) {
    body = (
      <div className="p-6">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>Your recent notes could not be loaded. {notes.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => notes.refetch()} disabled={notes.isFetching}>
          {notes.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else if (notes.data.items.length === 0) {
    body = <EmptyState icon={Mic} title="No notes yet" description="Your SOAP notes will be listed here, newest first." />;
  } else {
    body = (
      <>
        <div className={`hidden gap-4 border-b bg-muted px-6 py-3 text-sm font-medium text-muted-foreground sm:grid ${COLUMNS}`}>
          <span>Patient</span>
          <span>Date</span>
          <span>Status</span>
          <span className="sr-only">Open</span>
        </div>
        <ul className="divide-y">
          {notes.data.items.map((item) => (
            <li key={item.consultationId}>
              <RecentNoteRow item={item} />
            </li>
          ))}
        </ul>
        <div className="border-t px-6 py-4">
          <Button asChild variant="ghost" size="sm" className="-ml-3 text-primary hover:text-primary">
            <Link href="/doctor/patients">
              All patients and notes
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <Reveal delay={0.1} className="overflow-hidden rounded-[1.5rem] border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-5">
        <h2 className="font-display text-lg font-bold tracking-tight">Recent notes</h2>
        {notes.isSuccess && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground tabular-nums">
            {notes.data.total} total
          </span>
        )}
      </div>
      {body}
    </Reveal>
  );
}

// A listed note always belongs to a completed consultation.
function RecentNoteRow({ item }: { item: SoapNoteListItem }) {
  return (
    <Link
      href={`/doctor/consultations/${item.consultationId}/note`}
      className={`grid grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-x-4 gap-y-1 px-6 py-4 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:ring-inset ${COLUMNS}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-sm font-bold text-secondary-foreground"
        >
          {initials(item.patient.fullName)}
        </span>
        <div className="min-w-0">
          <p dir="auto" className="font-semibold break-words">
            {item.patient.fullName}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{item.patient.phone}</p>
          <p className="text-sm text-muted-foreground sm:hidden">{formatDate(item.date)}</p>
        </div>
      </div>
      <p className="hidden sm:block">{formatDate(item.date)}</p>
      <span className="hidden sm:block">
        <ConsultationStatusChip status="completed" />
      </span>
      <ChevronRight aria-hidden="true" className="col-start-2 row-start-1 size-5 text-muted-foreground sm:col-start-auto sm:row-start-auto" />
    </Link>
  );
}
