"use client";

import Link from "next/link";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, CircleAlert, CirclePlus, RotateCw, Search, SearchX, Users, X } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Highlight } from "@/components/shared/highlight";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { NEW_CONSULTATION_HREF } from "@/components/shared/nav-config";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_SEARCH_LENGTH, useSearchParam } from "@/hooks/use-search-param";
import { consultationsApi, patientsQueryKey } from "@/lib/api/consultations";
import type { ClinicalPatient } from "@/lib/api/types";
import { formatDate, GENDER_LABEL, initials } from "@/lib/format";

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
const COLUMNS = "sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_1.25rem]";

export function PatientsList() {
  const { input, setInput, query, tooShort, typing } = useSearchParam(SEARCH_DELAY_MS);

  const patients = useInfiniteQuery({
    queryKey: patientsQueryKey(query),
    queryFn: ({ pageParam }) => consultationsApi.listPatients({ q: query || undefined, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });

  const items = patients.data?.pages.flatMap((page) => page.items) ?? [];
  const total = patients.data?.pages[0]?.total ?? 0;
  const searching = (typing && !tooShort) || (patients.isPlaceholderData && patients.isFetching);

  let body: React.ReactNode;
  if (patients.isPending) {
    body = <ListSkeleton />;
  } else if (patients.isError) {
    body = (
      <div className="p-6">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>Your patients could not be loaded. {patients.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => patients.refetch()} disabled={patients.isFetching}>
          {patients.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0 && query) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No patients found"
        description={`No patient’s name or phone number has “${query}” in it. Check the spelling, or try part of the phone number.`}
        action={
          <Button variant="outline" onClick={() => setInput("")}>
            <X aria-hidden="true" data-icon="inline-start" />
            Clear search
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={Users}
        title="No patients yet"
        description="Patients are saved when you start their first consultation."
        action={
          <Button asChild size="lg">
            <Link href={NEW_CONSULTATION_HREF}>
              <CirclePlus aria-hidden="true" data-icon="inline-start" />
              New consultation
            </Link>
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <div className={`hidden gap-4 border-b bg-muted px-6 py-3 text-sm font-medium text-muted-foreground sm:grid ${COLUMNS}`}>
          <span>Patient</span>
          <span>Phone</span>
          <span>Added</span>
          <span className="sr-only">Open</span>
        </div>
        <ul className="divide-y">
          {items.map((patient) => (
            <li key={patient.clinicalPatientId}>
              <PatientRow patient={patient} query={query} />
            </li>
          ))}
        </ul>
        {patients.hasNextPage && (
          <div className="border-t p-4 text-center">
            <Button variant="outline" onClick={() => patients.fetchNextPage()} disabled={patients.isFetchingNextPage}>
              {patients.isFetchingNextPage && <Spinner className="size-4 text-current" label="Loading" />}
              {patients.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <PageTransition className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-primary">Patients & notes</p>
          <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[2.25rem]">
            Your patients
          </h1>
          <p className="leading-relaxed text-muted-foreground">Open a patient to see all their SOAP notes, newest first.</p>
        </div>
        <Button asChild variant="outline" className="self-start sm:self-auto">
          <Link href={NEW_CONSULTATION_HREF}>
            <CirclePlus aria-hidden="true" data-icon="inline-start" />
            New consultation
          </Link>
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="patientSearch">Search by name or phone</Label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="patientSearch"
            type="search"
            autoComplete="off"
            placeholder="For example Bilal or 0321"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-13 pr-12 pl-12 text-base md:text-base [&::-webkit-search-cancel-button]:hidden"
            aria-describedby="patientSearch-hint"
          />
          <span className="absolute inset-y-0 right-2 flex items-center">
            {searching ? (
              <Spinner className="mr-2 size-5" label="Searching" />
            ) : (
              input && (
                <Button variant="ghost" size="icon-sm" onClick={() => setInput("")} aria-label="Clear search">
                  <X aria-hidden="true" />
                </Button>
              )
            )}
          </span>
        </div>
        <p id="patientSearch-hint" className="text-sm text-muted-foreground" aria-live="polite">
          {tooShort ? `Type at least ${MIN_SEARCH_LENGTH} characters.` : "Part of the name or phone number is enough."}
        </p>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border bg-card">
        <div className="flex items-center justify-between gap-4 border-b px-6 py-5">
          <h2 className="font-display text-lg font-bold tracking-tight">{query ? "Matching patients" : "All patients"}</h2>
          {patients.isSuccess && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground tabular-nums">
              {total} {total === 1 ? "patient" : "patients"}
            </span>
          )}
        </div>
        {body}
      </div>
    </PageTransition>
  );
}

function PatientRow({ patient, query }: { patient: ClinicalPatient; query: string }) {
  return (
    <Link
      href={`/doctor/patients/${patient.clinicalPatientId}`}
      className={`grid grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-x-4 gap-y-1 px-6 py-4 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:ring-inset ${COLUMNS}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-sm font-bold text-secondary-foreground"
        >
          {initials(patient.fullName)}
        </span>
        <div className="min-w-0">
          {/* The whole name and phone are shown (not cut off), so a match is always visible. */}
          <p dir="auto" className="font-semibold break-words">
            <Highlight text={patient.fullName} query={query} />
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{patient.age}</span> years · {GENDER_LABEL[patient.gender]}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums sm:hidden">
            <Highlight text={patient.phone} query={query} />
          </p>
        </div>
      </div>
      <p className="hidden tabular-nums sm:block">
        <Highlight text={patient.phone} query={query} />
      </p>
      <p className="hidden truncate text-sm text-muted-foreground sm:block">{formatDate(patient.createdAt)}</p>
      <ChevronRight aria-hidden="true" className="col-start-2 row-start-1 size-5 text-muted-foreground sm:col-start-auto sm:row-start-auto" />
    </Link>
  );
}
