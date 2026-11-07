"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CloudCheck, CloudUpload, FileSearch, MicOff, RotateCw, Square, TimerReset, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChunkedRecorder } from "@/hooks/use-chunked-recorder";
import { useLeaveWarning } from "@/hooks/use-leave-warning";
import { useUploadQueue, type UploadQueueState } from "@/hooks/use-upload-queue";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { ApiError } from "@/lib/api/client";
import { consultationQueryKey, consultationsApi } from "@/lib/api/consultations";
import type { Consultation } from "@/lib/api/types";
import { isMicrophoneProblem, MicrophoneHelp } from "./microphone-help";
import { SoundLevel } from "./sound-level";

// A consultation is 30 minutes at most (FR-9): 180 parts of 10 seconds.
const MAX_PARTS = 180;
const MAX_SEC = MAX_PARTS * 10;
const WARN_AT_SEC = 28 * 60;
// Stop is tried again this many times when parts are missing (409 PARTS_MISSING).
const STOP_ROUNDS = 3;
const LEAVE_MESSAGE =
  "The recording is still running. If you leave this page, audio that is not saved yet is lost. Leave anyway?";

export function RecordScreen() {
  const params = useParams<{ id: string }>();
  const consultationId = /^\d+$/.test(params.id) ? Number(params.id) : null;

  // Loaded once: a later refresh must never replace the recorder while it runs.
  const consultation = useQuery({
    queryKey: consultationQueryKey(consultationId ?? 0),
    queryFn: () => consultationsApi.get(consultationId!),
    enabled: consultationId !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  let content: React.ReactNode;
  if (consultation.data) {
    content =
      consultation.data.status === "recording" ? (
        <Recorder consultation={consultation.data} />
      ) : (
        <Ended consultationId={consultation.data.consultationId} />
      );
  } else if (consultationId === null || (consultation.error instanceof ApiError && consultation.error.status === 404)) {
    content = <NotFound />;
  } else if (consultation.isError) {
    content = (
      <div className="rounded-[1.5rem] border bg-card p-6 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The consultation could not be loaded. {consultation.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => consultation.refetch()} disabled={consultation.isFetching}>
          {consultation.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
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

  return <PageTransition className="mx-auto w-full max-w-xl">{content}</PageTransition>;
}

// Parts recorded on this page before a reload, so numbering goes on after them.
const partsKey = (consultationId: number) => `mediassist.recording.${consultationId}.parts`;

function readPartsBefore(consultationId: number) {
  try {
    return Number(sessionStorage.getItem(partsKey(consultationId))) || 0;
  } catch {
    return 0;
  }
}

function writeParts(consultationId: number, parts: number | null) {
  try {
    if (parts === null) sessionStorage.removeItem(partsKey(consultationId));
    else sessionStorage.setItem(partsKey(consultationId), String(parts));
  } catch {
    // Storage is blocked. Only a reload during the recording is affected.
  }
}

type StopState = { step: "saving" } | { step: "error"; message: string } | { step: "done" } | null;

function Recorder({ consultation }: { consultation: Consultation }) {
  const router = useRouter();
  const consultationId = consultation.consultationId;
  const [partsBefore] = useState(() => readPartsBefore(consultationId));
  const queue = useUploadQueue(consultationId);
  const [stop, setStop] = useState<StopState>(null);
  const totalPartsRef = useRef<number | null>(null);
  const limitReachedRef = useRef<() => void>(() => {});

  const recorder = useChunkedRecorder({
    partsBefore,
    maxParts: MAX_PARTS,
    onPart: (part) => {
      writeParts(consultationId, part.partNo);
      queue.add(part);
    },
    onLimitReached: () => limitReachedRef.current(),
  });
  const { start, stop: stopRecorder } = recorder;
  const { waitUntilEmpty, resend } = queue;

  // Waits until every part is saved, then POST /stop. On PARTS_MISSING the missing parts are
  // uploaded again from memory and stop is called again.
  const submitStop = useCallback(
    async (totalParts: number) => {
      setStop({ step: "saving" });
      try {
        for (let round = 1; ; round++) {
          await waitUntilEmpty();
          try {
            await consultationsApi.stop(consultationId, totalParts);
            break;
          } catch (err) {
            if (!(err instanceof ApiError)) throw err;
            // Already stopped (for example the answer to an earlier stop was lost).
            if (err.code === "NOT_RECORDING") break;
            if (err.code !== "PARTS_MISSING" || round >= STOP_ROUNDS) throw err;
            const missing = Array.isArray(err.details.missingParts) ? (err.details.missingParts as number[]) : [];
            const lost = resend(missing);
            if (lost.length > 0) {
              throw new Error(
                `Audio part${lost.length > 1 ? "s" : ""} ${lost.join(", ")} did not arrive and ${lost.length > 1 ? "are" : "is"} no longer on this device, because the page was reloaded.`,
              );
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        setStop({ step: "error", message });
        return;
      }
      writeParts(consultationId, null);
      setStop({ step: "done" });
      router.replace(`/doctor/consultations/${consultationId}/processing`);
    },
    [consultationId, resend, router, waitUntilEmpty],
  );

  const finish = useCallback(async () => {
    if (totalPartsRef.current !== null) return;
    totalPartsRef.current = -1;
    setStop({ step: "saving" });
    const totalParts = await stopRecorder();
    totalPartsRef.current = totalParts;
    await submitStop(totalParts);
  }, [stopRecorder, submitStop]);

  const retryStop = () => {
    if (totalPartsRef.current === null || totalPartsRef.current < 0) return;
    if (queue.state.error) queue.retry();
    void submitStop(totalPartsRef.current);
  };

  useEffect(() => {
    limitReachedRef.current = () => {
      toast.info("The recording stopped at 30:00, the longest a consultation can be.");
      void finish();
    };
  }, [finish]);

  // The doctor already pressed "Start recording", so the microphone is asked for straight away.
  useEffect(() => {
    void start();
  }, [start]);

  const recording = recorder.status === "recording";
  const busy = stop?.step === "saving";
  useWakeLock(recording || busy);
  useLeaveWarning(recording || recorder.status === "interrupted" || busy || queue.state.pending > 0, LEAVE_MESSAGE);

  const header = (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-primary">Consultation recording</p>
      <h1
        dir="auto"
        className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[2.25rem]"
      >
        {consultation.patient.fullName}
      </h1>
      <p className="text-muted-foreground tabular-nums">{consultation.patient.phone}</p>
    </div>
  );

  if (isMicrophoneProblem(recorder.status)) {
    return (
      <div className="space-y-6">
        {header}
        <MicrophoneHelp status={recorder.status} onRetry={() => void start()} />
      </div>
    );
  }

  const elapsed = Math.min(recorder.elapsedSec, MAX_SEC);
  const stopped = stop !== null;

  return (
    <div className="space-y-6">
      {header}

      {recording && elapsed >= WARN_AT_SEC && (
        <Alert className="border-highlight/60 bg-peach text-peach-foreground">
          <TimerReset aria-hidden="true" />
          <AlertTitle>Less than 2 minutes left</AlertTitle>
          <AlertDescription className="text-peach-foreground">
            The recording stops by itself at 30:00 and the note is created.
          </AlertDescription>
        </Alert>
      )}

      <section
        aria-label="Recorder"
        className="rounded-[2rem] bg-navy p-6 text-navy-foreground sm:p-10 dark:ring-1 dark:ring-navy-border"
      >
        <div className="flex items-center justify-between gap-3">
          {stopped ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-current/10 px-3 py-1 text-sm font-semibold">
              <Square aria-hidden="true" className="size-3 fill-current" />
              Stopped
            </span>
          ) : recorder.status === "interrupted" ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-current/10 px-3 py-1 text-sm font-semibold">
              <MicOff aria-hidden="true" className="size-4" />
              Microphone off
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-rec/15 px-3 py-1 text-sm font-semibold">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-rec opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2.5 rounded-full bg-rec" />
              </span>
              Recording
            </span>
          )}
          <span className="text-sm text-navy-muted">Up to 30:00</span>
        </div>

        <p
          role="timer"
          aria-label={`Recording time ${formatTime(elapsed)}`}
          className="mt-8 text-center font-display text-7xl font-extrabold tracking-[-0.04em] tabular-nums sm:text-8xl"
        >
          {formatTime(elapsed)}
        </p>

        <div className="mt-6">
          <SoundLevel getLevel={recorder.getLevel} active={recording} />
        </div>

        <div className="mt-6 flex justify-center">
          <UploadStatus state={queue.state} onRetry={queue.retry} />
        </div>

        {recorder.status === "interrupted" && !stopped && (
          <p role="alert" className="mt-6 text-center leading-relaxed text-navy-muted">
            The microphone stopped working. The audio up to now is kept. Stop the recording to create the note.
          </p>
        )}

        <div className="mt-8">
          {stop?.step === "error" ? (
            <Button
              size="lg"
              onClick={retryStop}
              className="h-14 w-full bg-brand-bright text-base text-navy hover:bg-brand-bright/90"
            >
              <RotateCw aria-hidden="true" data-icon="inline-start" />
              Try again
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={() => void finish()}
              disabled={stopped || recorder.status === "idle"}
              className="h-14 w-full bg-brand-bright text-base text-navy hover:bg-brand-bright/90"
            >
              {stopped ? (
                <Spinner className="size-5 text-current" label="Saving the audio" />
              ) : (
                <Square aria-hidden="true" data-icon="inline-start" className="fill-current" />
              )}
              {stopped ? "Saving the audio…" : "Stop recording"}
            </Button>
          )}
        </div>
      </section>

      {stop?.step === "error" && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>The recording could not be finished</AlertTitle>
          <AlertDescription>{stop.message} Your audio is kept on this page. Press Try again.</AlertDescription>
        </Alert>
      )}

      <p className="text-center text-sm text-muted-foreground">
        Keep this page open until you stop. The audio is saved every 10 seconds, also when the internet drops.
      </p>
    </div>
  );
}

function UploadStatus({ state, onRetry }: { state: UploadQueueState; onRetry: () => void }) {
  const parts = `${state.pending} ${state.pending === 1 ? "part" : "parts"} pending`;
  const chip = "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold";

  if (state.error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 text-center">
        <span className={`${chip} bg-rec/15`}>
          <CircleAlert aria-hidden="true" className="size-4" />
          Audio not saved – {parts}
        </span>
        <p className="text-sm text-navy-muted">{state.error.message}</p>
        <Button size="sm" variant="ghost" onClick={onRetry} className="text-current hover:bg-current/10 hover:text-current">
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          Try again
        </Button>
      </div>
    );
  }

  let content: React.ReactNode;
  if (!state.online && state.pending > 0) {
    content = (
      <span className={`${chip} bg-peach text-peach-foreground`}>
        <WifiOff aria-hidden="true" className="size-4" />
        Waiting for internet – {parts}
      </span>
    );
  } else if (!state.online) {
    content = (
      <span className={`${chip} bg-peach text-peach-foreground`}>
        <WifiOff aria-hidden="true" className="size-4" />
        No internet. Recording goes on
      </span>
    );
  } else if (state.retrying) {
    content = (
      <span className={`${chip} bg-peach text-peach-foreground`}>
        <RotateCw aria-hidden="true" className="size-4" />
        Trying again – {parts}
      </span>
    );
  } else if (state.pending > 1) {
    content = (
      <span className={`${chip} bg-current/10`}>
        <CloudUpload aria-hidden="true" className="size-4" />
        Saving audio – {parts}
      </span>
    );
  } else {
    // One part in flight takes a moment only, so it is not shown as pending.
    content = (
      <span className={`${chip} bg-current/10`}>
        <CloudCheck aria-hidden="true" className="size-4 text-brand-bright" />
        All audio saved
      </span>
    );
  }

  return (
    <p role="status" aria-live="polite">
      {content}
    </p>
  );
}

function Ended({ consultationId }: { consultationId: number }) {
  return (
    <div className="rounded-[1.5rem] border bg-card">
      <EmptyState
        icon={Square}
        title="This recording has ended"
        description="The audio is saved. You can follow the note on the next page."
        action={
          <Button asChild size="lg">
            <Link href={`/doctor/consultations/${consultationId}/processing`}>Open the note</Link>
          </Button>
        }
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-[1.5rem] border bg-card">
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
    </div>
  );
}

function formatTime(totalSec: number) {
  const sec = Math.floor(totalSec);
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
