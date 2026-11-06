"use client";

import Link from "next/link";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, CircleAlert, FileSearch, RotateCw, Search, SearchX, X } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Highlight } from "@/components/shared/highlight";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MIN_SEARCH_LENGTH, useSearchParam } from "@/hooks/use-search-param";
import { consultationsApi, soapNoteSearchQueryKey } from "@/lib/api/consultations";
import type { SoapNoteListItem } from "@/lib/api/types";
import { formatDate, initials } from "@/lib/format";

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

export function SearchScreen() {
  const { input, setInput, query, tooShort, typing } = useSearchParam(SEARCH_DELAY_MS);

  const results = useInfiniteQuery({
    queryKey: soapNoteSearchQueryKey(query),
    queryFn: ({ pageParam }) => consultationsApi.searchSoapNotes({ q: query, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: query !== "",
    // While the next search runs, the last results stay on screen.
    placeholderData: keepPreviousData,
  });

  const items = results.data?.pages.flatMap((page) => page.items) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;
  const searching = query !== "" && ((typing && !tooShort) || results.isFetching) && !results.isFetchingNextPage;

  let body: React.ReactNode;
  if (query === "") {
    body = (
      <div className="rounded-[1.5rem] border bg-card">
        <EmptyState
          icon={FileSearch}
          title="Search your SOAP notes"
          description="Type part of a patient’s name or phone number. Only your own patients are searched."
        />
      </div>
    );
  } else if (results.isPending) {
    body = <ResultsSkeleton />;
  } else if (results.isError) {
    body = (
      <div className="rounded-[1.5rem] border bg-card p-6">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The search did not work. {results.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => results.refetch()} disabled={results.isFetching}>
          {results.isFetching ? <Spinner className="size-4 text-current" label="Searching" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="rounded-[1.5rem] border bg-card">
        <EmptyState
          icon={SearchX}
          title="No notes found"
          description={`No SOAP note matches “${query}”. Check the spelling, or try part of the phone number.`}
          action={
            <Button variant="outline" onClick={() => setInput("")}>
              <X aria-hidden="true" data-icon="inline-start" />
              Clear search
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="text-sm font-medium text-muted-foreground tabular-nums" aria-live="polite">
          {total} {total === 1 ? "note" : "notes"} found
        </p>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.consultationId} className="min-w-0">
              <ResultCard item={item} query={query} />
            </li>
          ))}
        </ul>
        {results.hasNextPage && (
          <div className="text-center">
            <Button variant="outline" onClick={() => results.fetchNextPage()} disabled={results.isFetchingNextPage}>
              {results.isFetchingNextPage && <Spinner className="size-4 text-current" label="Loading" />}
              {results.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <PageTransition className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-primary">Search</p>
        <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[2.25rem]">
          Search SOAP notes
        </h1>
        <p className="leading-relaxed text-muted-foreground">Find a note by the patient’s name or phone number.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="noteSearch">Patient name or phone</Label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="noteSearch"
            type="search"
            autoComplete="off"
            autoFocus
            placeholder="For example Bilal or 0321"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-14 pr-12 pl-12 text-lg md:text-lg [&::-webkit-search-cancel-button]:hidden"
            aria-describedby="noteSearch-hint"
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
        <p id="noteSearch-hint" className="text-sm text-muted-foreground" aria-live="polite">
          {tooShort ? `Type at least ${MIN_SEARCH_LENGTH} characters.` : "Part of the name or phone number is enough."}
        </p>
      </div>

      {body}
    </PageTransition>
  );
}

function ResultCard({ item, query }: { item: SoapNoteListItem; query: string }) {
  const { patient } = item;
  return (
    <Link
      href={`/doctor/consultations/${item.consultationId}/note`}
      className="group flex h-full items-center gap-4 rounded-[1.5rem] border bg-card p-5 transition-[transform,border-color] outline-none hover:-translate-y-1 hover:border-primary/40 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/30 sm:p-6"
    >
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-base font-bold text-secondary-foreground"
      >
        {initials(patient.fullName)}
      </span>
      <div className="min-w-0 flex-1">
        {/* The whole name is shown (not cut off), so a match in it is always visible. */}
        <p dir="auto" className="font-display text-lg font-bold tracking-tight break-words">
          <Highlight text={patient.fullName} query={query} />
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          <Highlight text={patient.phone} query={query} />
        </p>
        <p className="text-sm text-muted-foreground">{formatDate(item.date)}</p>
      </div>
      <ArrowRight
        aria-hidden="true"
        className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Searching">
      <Skeleton className="h-4 w-28" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 rounded-[1.5rem] border bg-card p-5 sm:p-6">
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-4 w-52 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
