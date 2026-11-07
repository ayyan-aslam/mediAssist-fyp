"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, CircleAlert, FileCheck, FileSearch, FileText, Mic, MicOff, RotateCw, Trash, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConsultationEventsStatus } from "@/context/consultation-events-context";
import { useConsultationEvents } from "@/hooks/use-consultation-events";
import { useStartConsultation } from "@/hooks/use-start-consultation";
import { ApiError } from "@/lib/api/client";
import { consultationQueryKey, consultationsApi, patientSoapNotesQueryKey, recentSoapNotesQueryKey } from "@/lib/api/consultations";
import type { Consultation, FailureReason } from "@/lib/api/types";
import { cn } from "@/lib/utils";

// The messages of consultation_failed (design doc 5.5), also used when the failure is read with GET.
const FAILURE_MESSAGES: Record<FailureReason, string> = {
  TRANSCRIPTION_FAILED: "Some audio could not be processed. Please try again.",
  AI_FAILED: "The SOAP note could not be written. Please try again.",
  AI_TIMEOUT: "The SOAP note is taking too long. Please try again.",
  NO_SPEECH: "No speech was heard in the recording. Please record the consultation again.",
};
const UNKNOWN_FAILURE_MESSAGE = "The SOAP note could not be created. Please try again.";

// The API does not say which step is running, so the step shown follows the usual timing:
// the last minute is transcribed first, then the AI Pipeline writes the note.
const TRANSCRIBING_SEC = 10;

const noteHref = (consultationId: number) => `/doctor/consultations/${consultationId}/note`;

export function ProcessingScreen() {
  const params = useParams<{ id: string }>();
  const consultationId = /^\d+$/.test(params.id) ? Number(params.id) : null;
  const router = useRouter();
  const queryClient = useQueryClient();
  // The message that came with consultation_failed. GET only has the reason.
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  // Set when the doctor presses Try again, so the elapsed time starts again.
  const [retriedAt, setRetriedAt] = useState<number | null>(null);

  const consultation = useQuery({
    queryKey: consultationQueryKey(consultationId ?? 0),
    queryFn: () => consultationsApi.get(consultationId!),
    enabled: consultationId !== null,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const { refetch } = consultation;

  // Each time the stream opens or opens again, read the consultation once, so a result
  // that came while it was closed is not missed.
  const { status: liveStatus } = useConsultationEvents({
    onConnect: () => {
      if (consultationId !== null) void refetch();
    },
    onEvent: ({ event, data }) => {
      if (data.consultationId !== consultationId) return;
      if (event === "soap_ready") {
        router.replace(noteHref(consultationId));
        return;
      }
      setFailureMessage(data.message);
      void refetch();
    },
  });

  // The cache may still hold the consultation as the record screen saw it ("recording"),
  // so only an answer read on this page counts.
  const current = consultation.isFetchedAfterMount ? consultation.data : undefined;

  useEffect(() => {
    if (current?.status === "completed") router.replace(noteHref(current.consultationId));
  }, [current, router]);

  const retry = useMutation({
    mutationFn: () => consultationsApi.retry(consultationId!),
    onSuccess: () => {
      setFailureMessage(null);
      setRetriedAt(Date.now());
      queryClient.setQueryData<Consultation>(consultationQueryKey(consultationId!), (old) =>
        old ? { ...old, status: "processing", failureReason: null } : old,
      );
    },
    onError: (err) => {
      // Already processing again (for example Try again in another tab): just read it.
      if (err instanceof ApiError && err.code === "NOT_FAILED") void refetch();
    },
  });

  let content: React.ReactNode;
  if (current) {
    const header = <Header consultation={current} />;
    if (current.status === "processing") {
      content = (
        <>
          {header}
          <Waiting
            since={retriedAt ?? (current.endedAt ? Date.parse(current.endedAt) : null)}
            liveStatus={liveStatus}
          />
        </>
      );
    } else if (current.status === "failed") {
      const retryError = retry.error instanceof ApiError && retry.error.code !== "NOT_FAILED" ? retry.error : null;
      content = (
        <>
          {header}
          <Failed
            message={
              failureMessage ??
              (current.failureReason ? FAILURE_MESSAGES[current.failureReason] : UNKNOWN_FAILURE_MESSAGE)
            }
            noSpeech={current.failureReason === "NO_SPEECH"}
            consultationId={current.consultationId}
            clinicalPatientId={current.patient.clinicalPatientId}
            retrying={retry.isPending}
            retryError={retryError?.message ?? null}
            onRetry={() => retry.mutate()}
          />
        </>
      );
    } else if (current.status === "completed") {
      content = (
        <>
          {header}
          <Panel>
            <EmptyState
              icon={FileCheck}
              title="Your SOAP note is ready"
              description="Opening the note…"
              action={
                <Button asChild size="lg">
                  <Link href={noteHref(current.consultationId)}>Open the note</Link>
                </Button>
              }
            />
          </Panel>
        </>
      );
    } else {
      content = (
        <>
          {header}
          <Panel>
            <EmptyState
              icon={Mic}
              title="This recording is still running"
              description="Stop the recording first. Then the SOAP note is prepared."
              action={
                <Button asChild size="lg">
                  <Link href={`/doctor/consultations/${current.consultationId}/record`}>Open the recording</Link>
                </Button>
              }
            />
          </Panel>
        </>
      );
    }
  } else if (consultationId === null || (consultation.error instanceof ApiError && consultation.error.status === 404)) {
    content = <NotFound />;
  } else if (consultation.isError) {
    content = (
      <Panel className="p-6 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The consultation could not be loaded. {consultation.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => refetch()} disabled={consultation.isFetching}>
          {consultation.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </Panel>
    );
  } else {
    content = (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-64 max-w-full" />
        </div>
        <Skeleton className="h-104 w-full rounded-[2rem]" />
      </div>
    );
  }

  return <PageTransition className="mx-auto w-full max-w-xl space-y-6">{content}</PageTransition>;
}

function Header({ consultation }: { consultation: Consultation }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-primary">Consultation</p>
      <h1
        dir="auto"
        className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[2.25rem]"
      >
        {consultation.patient.fullName}
      </h1>
      <p className="text-muted-foreground tabular-nums">{consultation.patient.phone}</p>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[1.5rem] border bg-card", className)}>{children}</div>;
}

// Seconds since the given time, updated every second.
function useElapsedSec(since: number | null) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // The server clock may be a little ahead of this device, so never below 0.
  return Math.max(0, Math.floor((now - (since ?? start)) / 1000));
}

function Waiting({ since, liveStatus }: { since: number | null; liveStatus: ConsultationEventsStatus }) {
  const elapsed = useElapsedSec(since);
  const steps = ["Audio saved", "Transcribing", "Writing the note"];
  const active = elapsed < TRANSCRIBING_SEC ? 1 : 2;

  return (
    <section
      aria-labelledby="preparing-title"
      className="rounded-[2rem] bg-navy p-6 text-navy-foreground sm:p-10 dark:ring-1 dark:ring-navy-border"
    >
      <div className="flex flex-col items-center text-center">
        <div className="relative flex size-24 items-center justify-center" aria-hidden="true">
          <motion.span
            className="absolute inset-0 rounded-full bg-brand-bright/20"
            animate={{ scale: [1, 1.18, 1], opacity: [0.7, 0.25, 0.7] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="relative flex size-16 items-center justify-center rounded-full bg-brand-bright text-navy">
            <FileText className="size-7" />
          </span>
        </div>

        <h2 id="preparing-title" className="mt-6 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Preparing your SOAP note
        </h2>
        <p className="mt-2 leading-relaxed text-navy-muted">
          This usually takes about 15 seconds. The note opens by itself when it is ready.
        </p>

        <p
          role="timer"
          aria-label={`Time since the recording stopped ${formatTime(elapsed)}`}
          className="mt-6 font-display text-4xl font-extrabold tracking-[-0.04em] tabular-nums sm:text-5xl"
        >
          {formatTime(elapsed)}
        </p>
      </div>

      <ol className="mx-auto mt-8 grid max-w-xs grid-cols-1 gap-4">
        {steps.map((label, index) => {
          const done = index < active;
          const isActive = index === active;
          return (
            <li key={label} aria-current={isActive ? "step" : undefined} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  done ? "bg-brand-bright text-navy" : "bg-current/10",
                )}
              >
                {done ? (
                  <Check className="size-4" strokeWidth={3} />
                ) : isActive ? (
                  <span className="size-2.5 animate-pulse rounded-full bg-brand-bright motion-reduce:animate-none" />
                ) : (
                  <span className="size-2 rounded-full bg-current/30" />
                )}
              </span>
              <span className={cn("font-semibold", !done && !isActive && "text-navy-muted")}>
                {label}
                {done && <span className="sr-only"> – done</span>}
                {isActive && <span className="sr-only"> – in progress</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <p role="status" aria-live="polite" className="mt-8 min-h-5 text-center text-sm text-navy-muted">
        {liveStatus === "reconnecting" && (
          <span className="inline-flex items-center gap-2">
            <WifiOff aria-hidden="true" className="size-4" />
            Reconnecting to live updates…
          </span>
        )}
      </p>
    </section>
  );
}

function Failed({
  message,
  noSpeech,
  consultationId,
  clinicalPatientId,
  retrying,
  retryError,
  onRetry,
}: {
  message: string;
  noSpeech: boolean;
  consultationId: number;
  clinicalPatientId: number;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
}) {
  const start = useStartConsultation();

  // Trying again would send the same silent audio, so a new recording for the same patient is offered.
  if (noSpeech) {
    return (
      <Panel className="space-y-5 p-6 sm:p-8">
        <Alert className="border-highlight/50 bg-peach text-peach-foreground">
          <MicOff aria-hidden="true" />
          <AlertTitle>No speech was heard</AlertTitle>
          <AlertDescription className="text-peach-foreground">{message}</AlertDescription>
        </Alert>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>Record for at least a few seconds, and speak close to the microphone.</li>
          <li>Check that the sound bars move while you speak.</li>
          <li>Make sure the right microphone is chosen in the browser.</li>
        </ul>
        <Button size="lg" className="w-full" onClick={() => start.mutate(clinicalPatientId)} disabled={start.isPending}>
          {start.isPending ? (
            <Spinner className="size-5 text-current" label="Starting" />
          ) : (
            <Mic aria-hidden="true" data-icon="inline-start" />
          )}
          {start.isPending ? "Starting…" : "Record again"}
        </Button>
        <DeleteConsultation consultationId={consultationId} clinicalPatientId={clinicalPatientId} />
      </Panel>
    );
  }

  return (
    <Panel className="space-y-5 p-6 sm:p-8">
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>The SOAP note was not created</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <p className="leading-relaxed text-muted-foreground">
        The audio is saved. Try again prepares the note from it. Nothing is recorded again.
      </p>
      <Button size="lg" className="w-full" onClick={onRetry} disabled={retrying}>
        {retrying ? (
          <Spinner className="size-5 text-current" label="Trying again" />
        ) : (
          <RotateCw aria-hidden="true" data-icon="inline-start" />
        )}
        {retrying ? "Trying again…" : "Try again"}
      </Button>
      {retryError && (
        <p role="alert" className="text-sm text-destructive">
          {retryError}
        </p>
      )}
      <DeleteConsultation consultationId={consultationId} clinicalPatientId={clinicalPatientId} />
    </Panel>
  );
}

// Deletes the failed consultation with its audio and transcript, after asking once on the page.
function DeleteConsultation({ consultationId, clinicalPatientId }: { consultationId: number; clinicalPatientId: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);

  const remove = useMutation({
    mutationFn: () => consultationsApi.discard(consultationId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: consultationQueryKey(consultationId) });
      void queryClient.invalidateQueries({ queryKey: patientSoapNotesQueryKey(clinicalPatientId) });
      void queryClient.invalidateQueries({ queryKey: recentSoapNotesQueryKey });
      toast.success("Consultation deleted");
      router.replace(`/doctor/patients/${clinicalPatientId}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "The consultation could not be deleted. Please try again."),
  });

  if (!asking) {
    return (
      <div className="flex justify-center border-t pt-4">
        <Button variant="ghost" size="sm" onClick={() => setAsking(true)} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash aria-hidden="true" data-icon="inline-start" />
          Delete this consultation
        </Button>
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-text" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <p id="delete-title" className="font-semibold">
        Delete this consultation?
      </p>
      <p id="delete-text" className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Its audio and transcript are deleted and it leaves the patient&apos;s history. This cannot be undone.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button variant="outline" onClick={() => setAsking(false)} disabled={remove.isPending}>
          Keep it
        </Button>
        <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
          {remove.isPending ? <Spinner className="size-4 text-current" label="Deleting" /> : <Trash aria-hidden="true" data-icon="inline-start" />}
          {remove.isPending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <Panel>
      <EmptyState
        icon={FileSearch}
        title="Consultation not found"
        description="This consultation does not exist, or it belongs to another doctor."
        action={
          <Button asChild size="lg">
            <Link href="/doctor/consultations/new">New consultation</Link>
          </Button>
        }
      />
    </Panel>
  );
}

function formatTime(totalSec: number) {
  return `${String(Math.floor(totalSec / 60)).padStart(2, "0")}:${String(totalSec % 60).padStart(2, "0")}`;
}
