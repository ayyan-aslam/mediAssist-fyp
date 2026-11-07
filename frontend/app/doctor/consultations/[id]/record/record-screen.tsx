"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CloudCheck,
  CloudUpload,
  FileSearch,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Square,
  TimerReset,
  Trash,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChunkedRecorder } from "@/hooks/use-chunked-recorder";
import { useLeaveWarning } from "@/hooks/use-leave-warning";
import { useStartConsultation } from "@/hooks/use-start-consultation";
import { useUploadQueue, type UploadQueueState } from "@/hooks/use-upload-queue";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { ApiError } from "@/lib/api/client";
import { consultationQueryKey, consultationsApi } from "@/lib/api/consultations";
import type { Consultation } from "@/lib/api/types";
import { cn } from "@/lib/utils";
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
  const { start, stop: stopRecorder, pause, resume } = recorder;
  const { waitUntilEmpty, resend } = queue;

  // Start over / discard: asked first, with the recording paused while the doctor decides.
  const [confirm, setConfirm] = useState<"restart" | "discard" | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const resumeAfterConfirmRef = useRef(false);
  const startAgain = useStartConsultation();

  const askConfirm = (kind: "restart" | "discard") => {
    resumeAfterConfirmRef.current = recorder.status === "recording";
    if (resumeAfterConfirmRef.current) pause();
    setConfirm(kind);
  };

  const keepRecording = () => {
    setConfirm(null);
    if (resumeAfterConfirmRef.current) resume();
  };

  // Deletes this consultation and its audio, then opens a new recording (start over) or the patient.
  const discardRecording = async () => {
    const kind = confirm;
    setDiscarding(true);
    try {
      await consultationsApi.discard(consultationId);
    } catch (err) {
      setDiscarding(false);
      if (err instanceof ApiError && err.code === "CANNOT_DISCARD") {
        toast.info("This recording was already stopped, so it was kept.");
        router.replace(`/doctor/consultations/${consultationId}/processing`);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "The recording could not be discarded. Please try again.");
      return;
    }
    recorder.cancel();
    queue.cancel();
    writeParts(consultationId, null);
    if (kind === "restart") {
      startAgain.mutate(consultation.patient.clinicalPatientId);
    } else {
      toast.success("Recording discarded");
      router.replace(`/doctor/patients/${consultation.patient.clinicalPatientId}`);
    }
  };

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
  const paused = recorder.status === "paused";
  const busy = stop?.step === "saving" || discarding;
  useWakeLock(recording || paused || busy);
  useLeaveWarning(
    recording || paused || recorder.status === "interrupted" || busy || queue.state.pending > 0,
    LEAVE_MESSAGE,
  );

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
  const canDiscard = !stopped && (recording || paused || recorder.status === "interrupted");

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
          ) : paused ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-highlight/20 px-3 py-1 text-sm font-semibold text-highlight">
              <Pause aria-hidden="true" className="size-3.5 fill-current" />
              Paused
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
          className={cn(
            "mt-8 text-center font-display text-7xl font-extrabold tracking-[-0.04em] tabular-nums transition-opacity sm:text-8xl",
            paused && "animate-pulse opacity-60 motion-reduce:animate-none",
          )}
        >
          {formatTime(elapsed)}
        </p>
        {paused && (
          <p role="status" className="mt-2 text-center text-sm font-medium text-navy-muted">
            Nothing is recorded while paused. Press Resume to go on.
          </p>
        )}

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
          {confirm && canDiscard ? (
            <div role="alertdialog" aria-labelledby="discard-title" aria-describedby="discard-text" className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <p id="discard-title" className="font-display text-lg font-bold">
                {confirm === "restart" ? "Start over from 00:00?" : "Discard this recording?"}
              </p>
              <p id="discard-text" className="mt-1 text-sm leading-relaxed text-navy-muted">
                The {formatTime(elapsed)} recorded so far is deleted and no note is made.
                {confirm === "restart" ? " A new recording starts for the same patient." : ""} This cannot be undone.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Button
                  size="lg"
                  onClick={keepRecording}
                  disabled={discarding}
                  className="h-12 bg-white/10 text-navy-foreground ring-1 ring-white/15 hover:bg-white/15"
                >
                  Keep recording
                </Button>
                <Button size="lg" onClick={() => void discardRecording()} disabled={discarding} className="h-12 bg-rec text-white hover:bg-rec/90">
                  {discarding ? (
                    <Spinner className="size-5 text-current" label="Deleting" />
                  ) : confirm === "restart" ? (
                    <RotateCcw aria-hidden="true" data-icon="inline-start" />
                  ) : (
                    <Trash aria-hidden="true" data-icon="inline-start" />
                  )}
                  {discarding ? "Deleting…" : confirm === "restart" ? "Start over" : "Discard"}
                </Button>
              </div>
            </div>
          ) : stop?.step === "error" ? (
            <Button
              size="lg"
              onClick={retryStop}
              className="h-14 w-full bg-brand-bright text-base text-navy hover:bg-brand-bright/90"
            >
              <RotateCw aria-hidden="true" data-icon="inline-start" />
              Try again
            </Button>
          ) : (
            <div className={cn("grid gap-3", !stopped && (recording || paused) && "sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
              {!stopped && (recording || paused) && (
                <Button
                  size="lg"
                  onClick={paused ? resume : pause}
                  aria-pressed={paused}
                  className={cn(
                    "h-14 w-full text-base",
                    paused
                      ? "bg-highlight text-navy hover:bg-highlight/90"
                      : "bg-white/10 text-navy-foreground ring-1 ring-white/15 hover:bg-white/15",
                  )}
                >
                  {paused ? (
                    <Play aria-hidden="true" data-icon="inline-start" className="fill-current" />
                  ) : (
                    <Pause aria-hidden="true" data-icon="inline-start" className="fill-current" />
                  )}
                  {paused ? "Resume" : "Pause"}
                </Button>
              )}
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
                {stopped ? "Saving the audio…" : "Stop and create note"}
              </Button>
            </div>
          )}

          {canDiscard && !confirm && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => askConfirm("restart")}
                className="text-navy-muted hover:bg-white/10 hover:text-navy-foreground"
              >
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                Start over
              </Button>
              <span aria-hidden="true" className="h-4 w-px bg-white/15" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => askConfirm("discard")}
                className="text-navy-muted hover:bg-rec/15 hover:text-rec"
              >
                <Trash aria-hidden="true" data-icon="inline-start" />
                Discard
              </Button>
            </div>
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
