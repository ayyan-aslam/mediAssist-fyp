"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleAlert, CloudAlert, CloudCheck, FileDown, FileSearch, Hourglass, Loader2, PenLine, RotateCw, Save } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SOAP_PARTS, useSoapNoteEditor, type SaveState } from "@/hooks/use-soap-note-editor";
import { ApiError } from "@/lib/api/client";
import { consultationQueryKey, consultationsApi, patientQueryKey, soapNoteQueryKey } from "@/lib/api/consultations";
import type { Consultation, SoapNote, SoapPart } from "@/lib/api/types";
import { GENDER_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

// A SOAP part is at most 10,000 characters (Consultation Service check).
const MAX_PART_LENGTH = 10_000;
const SHOW_COUNT_FROM = 9_000;

const PARTS: Record<SoapPart, { title: string; hint: string }> = {
  subjective: { title: "Subjective", hint: "What the patient says: complaints, history and how long." },
  objective: { title: "Objective", hint: "What you found: examination, vital signs and test results." },
  assessment: { title: "Assessment", hint: "Your diagnosis." },
  plan: { title: "Plan", hint: "Medicines, tests, advice and follow-up." },
};

const notRetried404Or409 = (count: number, err: Error) =>
  !(err instanceof ApiError && (err.status === 404 || err.status === 409)) && count < 2;

export function NoteScreen() {
  const params = useParams<{ id: string }>();
  const consultationId = /^\d+$/.test(params.id) ? Number(params.id) : null;

  const consultation = useQuery({
    queryKey: consultationQueryKey(consultationId ?? 0),
    queryFn: () => consultationsApi.get(consultationId!),
    enabled: consultationId !== null,
    retry: notRetried404Or409,
  });

  // Read fresh each time the page opens (it starts the editing session), and never again while
  // the doctor edits, so a refetch cannot replace what they typed.
  const soapNote = useQuery({
    queryKey: soapNoteQueryKey(consultationId ?? 0),
    queryFn: () => consultationsApi.getSoapNote(consultationId!),
    enabled: consultationId !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: notRetried404Or409,
  });

  const failed = soapNote.error ?? consultation.error;
  const refetchAll = () => {
    if (consultation.isError) void consultation.refetch();
    if (soapNote.isError) void soapNote.refetch();
  };

  let content: React.ReactNode;
  if (consultationId === null || (failed instanceof ApiError && failed.status === 404)) {
    content = <NotFound />;
  } else if (soapNote.error instanceof ApiError && soapNote.error.code === "SOAP_NOT_READY") {
    content = <NotReady consultationId={consultationId} />;
  } else if (consultation.data && soapNote.data) {
    content = <NoteEditor key={soapNote.data.soapNoteId} consultation={consultation.data} note={soapNote.data} />;
  } else if (failed) {
    const fetching = consultation.isFetching || soapNote.isFetching;
    content = (
      <div className="mx-auto max-w-xl rounded-[1.5rem] border bg-card p-6 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The SOAP note could not be loaded. {failed.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={refetchAll} disabled={fetching}>
          {fetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else {
    content = <NoteSkeleton />;
  }

  return <PageTransition>{content}</PageTransition>;
}

function NoteEditor({ consultation, note }: { consultation: Consultation; note: SoapNote }) {
  const { values, setPart, saveState, saveNow, finishEditing } = useSoapNoteEditor(note);
  const [finishing, setFinishing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Saves the last changes first, so the PDF has what is on the screen.
  const downloadPdf = async () => {
    setDownloading(true);
    try {
      if (!(await saveNow())) {
        toast.error("The note could not be saved, so the PDF was not made. Check your internet connection and try again.");
        return;
      }
      const pdf = await consultationsApi.downloadSoapNotePdf(consultation.consultationId);
      saveFile(pdf, pdfFileName(consultation));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The PDF could not be downloaded. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const save = async () => {
    setFinishing(true);
    try {
      if (await finishEditing()) toast.success("SOAP note saved");
      else toast.error("The note could not be saved. Check your internet connection. It is tried again by itself.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The note could not be saved. Please try again.");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold text-primary">SOAP note</p>
          <h1
            dir="auto"
            className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[2.25rem]"
          >
            {consultation.patient.fullName}
          </h1>
          <p className="text-muted-foreground">{formatDateTime(consultation.startedAt)}</p>
        </div>
        <Button variant="outline" onClick={downloadPdf} disabled={downloading} className="self-start sm:self-auto">
          {downloading ? (
            <Spinner className="size-4 text-current" label="Downloading" />
          ) : (
            <FileDown aria-hidden="true" data-icon="inline-start" />
          )}
          {downloading ? "Preparing PDF…" : "Download PDF"}
        </Button>
      </div>

      <div className="sticky top-18 z-10 -mx-4 flex items-center justify-between gap-3 border-y bg-background/90 px-4 py-3 backdrop-blur-lg sm:mx-0 sm:rounded-2xl sm:border">
        <SaveStatus state={saveState} />
        <Button onClick={save} disabled={finishing}>
          {finishing ? <Spinner className="size-4 text-current" label="Saving" /> : <Save aria-hidden="true" data-icon="inline-start" />}
          {finishing ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          {SOAP_PARTS.map((part) => (
            <SoapSection key={part} part={part} value={values[part]} onChange={(value) => setPart(part, value)} />
          ))}
        </div>
        <PatientPanel consultation={consultation} />
      </div>
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  let icon: React.ReactNode;
  let text: string;
  if (state.kind === "saving") {
    icon = <Loader2 aria-hidden="true" className="size-4 animate-spin" />;
    text = "Saving…";
  } else if (state.kind === "error") {
    icon = <CloudAlert aria-hidden="true" className="size-4" />;
    text = "Not saved – retrying";
  } else if (state.kind === "unsaved") {
    icon = <PenLine aria-hidden="true" className="size-4" />;
    text = "Changes not saved yet";
  } else {
    icon = <CloudCheck aria-hidden="true" className="size-4 text-primary" />;
    text = `Saved at ${formatTime(state.at)}`;
  }
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-w-0 items-center gap-2 text-sm font-medium tabular-nums",
        state.kind === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {icon}
      <span className="truncate">{text}</span>
    </p>
  );
}

function SoapSection({ part, value, onChange }: { part: SoapPart; value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { title, hint } = PARTS[part];
  const id = `soap-${part}`;

  // Grows with the text. Browsers without CSS field-sizing get the height set here.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-[1.5rem] border bg-card p-5 sm:p-6">
      <h2 id={`${id}-title`} className="font-display text-xl font-bold tracking-tight">
        <label htmlFor={id}>{title}</label>
      </h2>
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">
        {hint}
      </p>
      <Textarea
        ref={ref}
        id={id}
        dir="auto"
        value={value}
        maxLength={MAX_PART_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
        rows={4}
        className="mt-4 min-h-32 resize-none text-base leading-relaxed md:text-base"
      />
      {value.length >= SHOW_COUNT_FROM && (
        <p className="mt-2 text-right text-xs text-muted-foreground tabular-nums">
          {value.length.toLocaleString("en-GB")} / {MAX_PART_LENGTH.toLocaleString("en-GB")}
        </p>
      )}
    </section>
  );
}

function PatientPanel({ consultation }: { consultation: Consultation }) {
  const patientId = consultation.patient.clinicalPatientId;
  const patient = useQuery({
    queryKey: patientQueryKey(patientId),
    queryFn: () => consultationsApi.getPatient(patientId),
  });

  const rows: [string, React.ReactNode][] = [
    ["Phone", <span key="phone" className="tabular-nums">{consultation.patient.phone}</span>],
  ];
  if (patient.data) {
    rows.unshift(["Age", `${patient.data.age} years`], ["Gender", GENDER_LABEL[patient.data.gender]]);
    rows.push(["Email", patient.data.email ?? "Not saved"]);
  }

  return (
    <aside aria-labelledby="patient-title" className="min-w-0 rounded-[1.5rem] border bg-card p-5 sm:p-6 lg:sticky lg:top-40">
      <h2 id="patient-title" className="font-display text-xl font-bold tracking-tight">
        Patient
      </h2>
      <p dir="auto" className="mt-1 font-semibold break-words">
        {consultation.patient.fullName}
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        {patient.isPending && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        )}
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {patient.isError && <p className="mt-3 text-sm text-muted-foreground">Age, gender and email could not be loaded.</p>}
      <Button asChild variant="outline" className="mt-5 w-full">
        <Link href={`/doctor/patients/${patientId}`}>
          Other notes of this patient
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </Button>
    </aside>
  );
}

function NoteSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-16 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          {SOAP_PARTS.map((part) => (
            <Skeleton key={part} className="h-56 w-full rounded-[1.5rem]" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-[1.5rem]" />
      </div>
    </div>
  );
}

function NotReady({ consultationId }: { consultationId: number }) {
  return (
    <div className="mx-auto max-w-xl rounded-[1.5rem] border bg-card">
      <EmptyState
        icon={Hourglass}
        title="The SOAP note is not ready yet"
        description="It is still being prepared, or it could not be created. Open the progress page to see where it is."
        action={
          <Button asChild size="lg">
            <Link href={`/doctor/consultations/${consultationId}/processing`}>See the progress</Link>
          </Button>
        }
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-[1.5rem] border bg-card">
      <EmptyState
        icon={FileSearch}
        title="SOAP note not found"
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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Like "SOAP note - Bilal Hussain - 2026-10-07.pdf". Characters that file names cannot hold are removed.
// The date is the local one, like the date shown above the note (startedAt is in UTC).
function pdfFileName(consultation: Consultation) {
  const name = consultation.patient.fullName.replace(/[\\/:*?"<>|]+/g, "").trim();
  const started = new Date(consultation.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}`;
  return `SOAP note - ${name} - ${date}.pdf`;
}

function saveFile(file: Blob, fileName: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download after click() returns, so the link is freed a little later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
