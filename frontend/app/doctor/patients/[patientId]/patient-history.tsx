"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CircleAlert,
  FileText,
  Mail,
  MailCheck,
  Mic,
  Pencil,
  Phone,
  RotateCw,
  UserRoundSearch,
} from "lucide-react";
import { toast } from "sonner";
import { ConsultationStatusChip, consultationHref } from "@/components/shared/consultation-status";
import { EmptyState } from "@/components/shared/empty-state";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrescription } from "@/hooks/use-prescription";
import { useStartConsultation } from "@/hooks/use-start-consultation";
import { ApiError } from "@/lib/api/client";
import { consultationQueryKey, consultationsApi, patientQueryKey, patientSoapNotesQueryKey } from "@/lib/api/consultations";
import { deliveriesQueryKey, prescriptionsApi } from "@/lib/api/prescriptions";
import type { ClinicalPatient, PatientSoapNoteItem } from "@/lib/api/types";
import { PatientForm, type PatientDetails } from "@/app/doctor/consultations/new/patient-form";
import { firstLine, formatDate, GENDER_LABEL, initials } from "@/lib/format";

const PAGE_SIZE = 10;

const notRetried404 = (count: number, err: Error) => !(err instanceof ApiError && err.status === 404) && count < 2;

// What a card says when the consultation has no SOAP note yet.
const NO_NOTE_TEXT: Record<PatientSoapNoteItem["status"], string> = {
  completed: "No assessment written.",
  processing: "The SOAP note is being prepared.",
  recording: "The recording has not been stopped.",
  failed: "The SOAP note could not be created. Open it to try again.",
};

export function PatientHistory() {
  const params = useParams<{ patientId: string }>();
  const patientId = /^\d+$/.test(params.patientId) ? Number(params.patientId) : null;

  const patient = useQuery({
    queryKey: patientQueryKey(patientId ?? 0),
    queryFn: () => consultationsApi.getPatient(patientId!),
    enabled: patientId !== null,
    retry: notRetried404,
  });

  let content: React.ReactNode;
  if (patientId === null || (patient.error instanceof ApiError && patient.error.status === 404)) {
    content = <NotFound />;
  } else if (patient.isError) {
    content = (
      <div className="mx-auto max-w-xl rounded-[1.5rem] border bg-card p-6 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The patient could not be loaded. {patient.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => patient.refetch()} disabled={patient.isFetching}>
          {patient.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else {
    content = (
      <div className="space-y-8">
        {patient.data ? <PatientCard patient={patient.data} /> : <PatientCardSkeleton />}
        {patient.data && <EditPatient patient={patient.data} />}
        <SoapNotes patientId={patientId} />
      </div>
    );
  }

  return (
    <PageTransition className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href="/doctor/patients">
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          All patients
        </Link>
      </Button>
      {content}
    </PageTransition>
  );
}

function PatientCard({ patient }: { patient: ClinicalPatient }) {
  const start = useStartConsultation();
  const starting = start.isPending || start.isSuccess;

  return (
    <section aria-labelledby="patient-name" className="rounded-[1.75rem] bg-mint p-6 text-mint-foreground sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-current/10 font-display text-xl font-bold sm:size-16 sm:text-2xl"
          >
            {initials(patient.fullName)}
          </span>
          <div className="min-w-0 space-y-1">
            <h1
              id="patient-name"
              dir="auto"
              className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[2.25rem]"
            >
              {patient.fullName}
            </h1>
            <p className="text-lg opacity-80">
              <span className="tabular-nums">{patient.age}</span> years · {GENDER_LABEL[patient.gender]}
            </p>
          </div>
        </div>
        <Button
          size="lg"
          onClick={() => start.mutate(patient.clinicalPatientId)}
          disabled={starting}
          className="w-full sm:w-auto lg:shrink-0"
        >
          {starting ? <Spinner className="size-4 text-current" label="Starting" /> : <Mic aria-hidden="true" data-icon="inline-start" />}
          {starting ? "Starting…" : "New consultation for this patient"}
        </Button>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 border-t border-current/10 pt-5 text-sm sm:grid-cols-3">
        <div className="flex min-w-0 items-center gap-2">
          <Phone aria-hidden="true" className="size-4 shrink-0 opacity-80" />
          <dt className="sr-only">Phone</dt>
          <dd className="truncate font-medium tabular-nums">{patient.phone}</dd>
        </div>
        <div className="flex min-w-0 items-start gap-2">
          <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0 opacity-80" />
          <dt className="sr-only">Email</dt>
          <dd dir={patient.email ? "ltr" : undefined} className="min-w-0 font-medium break-all">
            {patient.email ?? <span className="font-normal opacity-80">No email saved</span>}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-2 sm:justify-end">
          <dt className="opacity-80">Patient since</dt>
          <dd className="font-medium">{formatDate(patient.createdAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function SoapNotes({ patientId }: { patientId: number }) {
  const notes = useInfiniteQuery({
    queryKey: patientSoapNotesQueryKey(patientId),
    queryFn: ({ pageParam }) => consultationsApi.listPatientSoapNotes(patientId, { page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    retry: notRetried404,
  });

  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const total = notes.data?.pages[0]?.total ?? 0;

  let body: React.ReactNode;
  if (notes.isPending) {
    body = (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-36 w-full rounded-[1.5rem]" />
        ))}
      </div>
    );
  } else if (notes.isError) {
    body = (
      <div className="rounded-[1.5rem] border bg-card p-6">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The SOAP notes could not be loaded. {notes.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => notes.refetch()} disabled={notes.isFetching}>
          {notes.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="rounded-[1.5rem] border bg-card">
        <EmptyState
          icon={FileText}
          title="No consultations yet"
          description="Start a consultation for this patient. Its SOAP note is listed here."
        />
      </div>
    );
  } else {
    body = (
      <>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.consultationId} className="min-w-0">
              <NoteCard item={item} />
            </li>
          ))}
        </ul>
        {notes.hasNextPage && (
          <div className="text-center">
            <Button variant="outline" onClick={() => notes.fetchNextPage()} disabled={notes.isFetchingNextPage}>
              {notes.isFetchingNextPage && <Spinner className="size-4 text-current" label="Loading" />}
              {notes.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby="notes-title" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="notes-title" className="font-display text-xl font-bold tracking-tight">
          SOAP notes
        </h2>
        {notes.isSuccess && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground tabular-nums">
            {total} total
          </span>
        )}
      </div>
      {body}
    </section>
  );
}

function NoteCard({ item }: { item: PatientSoapNoteItem }) {
  const assessment = firstLine(item.assessment);
  return (
    <Link
      href={consultationHref(item.consultationId, item.status)}
      className="group flex h-full flex-col gap-3 rounded-[1.5rem] border bg-card p-5 transition-[transform,border-color] outline-none hover:-translate-y-1 hover:border-primary/40 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/30 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-lg font-bold tracking-tight">{formatDate(item.date)}</p>
        <ConsultationStatusChip status={item.status} />
      </div>
      <NoteCardBadges item={item} />
      {assessment ? (
        <p dir="auto" className="line-clamp-2 leading-relaxed break-words">
          {assessment}
        </p>
      ) : (
        <p className="leading-relaxed text-muted-foreground">{NO_NOTE_TEXT[item.status]}</p>
      )}
      <p className="mt-auto flex items-center gap-1.5 pt-1 text-sm font-semibold text-primary">
        {item.status === "completed" ? "Open the note" : "See the details"}
        <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
      </p>
    </Link>
  );
}

// The follow-up date and "Prescription sent", read from the consultation and its prescription.
// Shown only when they load; a card never waits for them.
function NoteCardBadges({ item }: { item: PatientSoapNoteItem }) {
  const completed = item.status === "completed";
  const consultation = useQuery({
    queryKey: consultationQueryKey(item.consultationId),
    queryFn: () => consultationsApi.get(item.consultationId),
    enabled: completed,
  });
  const prescription = usePrescription(item.consultationId, { enabled: completed });
  const prescriptionId = prescription.data?.prescriptionId;
  const deliveries = useQuery({
    queryKey: deliveriesQueryKey(prescriptionId ?? 0),
    queryFn: () => prescriptionsApi.listDeliveries(prescriptionId!),
    enabled: prescriptionId !== undefined,
  });

  const followUpDate = consultation.data?.followUpDate;
  const sent = deliveries.data?.items.some((d) => d.status === "sent") ?? false;
  if (!followUpDate && !sent) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {followUpDate && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-sky-foreground">
          <CalendarClock aria-hidden="true" className="size-3" />
          Follow-up {formatDate(followUpDate)}
        </span>
      )}
      {sent && (
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
          <MailCheck aria-hidden="true" className="size-3" />
          Prescription sent
        </span>
      )}
    </div>
  );
}

// Edit the patient's details. ?edit=1 opens it (from the SOAP note, to add an email); with
// &note=<consultationId> the note opens again after saving.
function EditPatient({ patient }: { patient: ClinicalPatient }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const note = searchParams.get("note");
  const noteId = note && /^\d+$/.test(note) ? note : null;
  const [editing, setEditing] = useState(() => searchParams.get("edit") === "1");

  async function save(changes: Partial<PatientDetails>) {
    if (Object.keys(changes).length > 0) {
      const updated = await consultationsApi.updatePatient(patient.clinicalPatientId, changes);
      queryClient.setQueryData(patientQueryKey(patient.clinicalPatientId), updated);
      toast.success("The patient’s details are saved.");
    }
    setEditing(false);
    if (noteId) router.push(`/doctor/consultations/${noteId}/note`);
    else router.replace(`/doctor/patients/${patient.clinicalPatientId}`, { scroll: false });
  }

  if (!editing) {
    return (
      <div className="-mt-4 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" data-icon="inline-start" />
          Edit details
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby="edit-patient-title" className="rounded-[1.5rem] border bg-card p-5 sm:p-8">
      <h2 id="edit-patient-title" className="font-display text-xl font-bold tracking-tight">
        Edit the patient’s details
      </h2>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        {noteId
          ? "Add the patient’s email to send the prescription. The SOAP note opens again after you save."
          : "Change only what is wrong. The phone number cannot be changed here."}
      </p>
      <PatientForm
        patient={patient}
        submitLabel={noteId ? "Save and go back to the note" : "Save details"}
        busyLabel="Saving…"
        onSubmit={save}
        onCancel={() => {
          setEditing(false);
          if (noteId) router.push(`/doctor/consultations/${noteId}/note`);
        }}
      />
    </section>
  );
}

function PatientCardSkeleton() {
  return (
    <div className="rounded-[1.75rem] border p-6 sm:p-8" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full sm:size-16" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
      <Skeleton className="mt-6 h-5 w-full max-w-md" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-[1.5rem] border bg-card">
      <EmptyState
        icon={UserRoundSearch}
        title="Patient not found"
        description="This patient does not exist, or belongs to another doctor."
        action={
          <Button asChild size="lg">
            <Link href="/doctor/patients">All patients</Link>
          </Button>
        }
      />
    </div>
  );
}
