"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarX, CircleAlert, RotateCw, ScrollText, SearchX, X } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FormError } from "@/components/shared/form-error";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageTransition } from "@/components/shared/page-transition";
import { Pager } from "@/components/shared/pager";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi, auditLogsQueryKey, type AuditLogFilters } from "@/lib/api/admin";
import type { AuditAction, AuditLog } from "@/lib/api/types";
import { formatDateTime, ROLE_LABEL } from "@/lib/format";
import { UserFilter } from "./user-filter";

const PAGE_SIZE = 20;
const ALL = "all";
const COLUMNS = "xl:grid-cols-[9.5rem_minmax(0,1.1fr)_10rem_minmax(0,1.6fr)_8.5rem]";

// AUDIT_LOG.action values (design doc 4.6), in the order of FR-17.
const ACTION_LABEL: Record<AuditAction, string> = {
  login: "Logged in",
  logout: "Logged out",
  document_upload: "Uploaded a document",
  soap_note_change: "Changed a SOAP note",
  prescription_send: "Sent a prescription",
  account_suspension: "Suspended an account",
};
const ACTIONS = Object.keys(ACTION_LABEL) as AuditAction[];

// Today in the browser's time zone, as YYYY-MM-DD.
const today = () => new Date().toLocaleDateString("en-CA");

export function AuditLogList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState<AuditAction | typeof ALL>(ALL);
  // Kept in the URL, so the user detail page can link to their log.
  const urlUserId = searchParams.get("userId");
  const userId = urlUserId && /^\d+$/.test(urlUserId) ? Number(urlUserId) : null;
  const setUserId = (next: number | null) =>
    router.replace(next === null ? pathname : `${pathname}?userId=${next}`, { scroll: false });

  const rangeError = Boolean(from && to && from > to);
  const filterKey = `${from}|${to}|${userId}|${action}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;

  const filters: AuditLogFilters = {
    from: from || undefined,
    to: to || undefined,
    userId: userId ?? undefined,
    action: action === ALL ? undefined : action,
    page,
    pageSize: PAGE_SIZE,
  };
  const logs = useQuery({
    queryKey: auditLogsQueryKey(filters),
    queryFn: () => adminApi.listAuditLogs(filters),
    enabled: !rangeError,
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(from || to) || userId !== null || action !== ALL;
  const items = logs.data?.items ?? [];
  const total = logs.data?.total ?? 0;

  const clearAll = () => {
    setFrom("");
    setTo("");
    setAction(ALL);
    setUserId(null);
  };

  const clearButton = (
    <Button variant="outline" onClick={clearAll}>
      <X aria-hidden="true" data-icon="inline-start" />
      Clear filters
    </Button>
  );

  let body: React.ReactNode;
  if (rangeError) {
    body = (
      <EmptyState
        icon={CalendarX}
        title="Check the dates"
        description="The From date must be on or before the To date."
        action={clearButton}
      />
    );
  } else if (logs.isPending) {
    body = <ListSkeleton />;
  } else if (logs.isError) {
    body = (
      <div className="p-6">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The audit log could not be loaded. {logs.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => logs.refetch()} disabled={logs.isFetching}>
          {logs.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0 && filtered) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No entries found"
        description="No action matches these filters. Try a wider date range or another user."
        action={clearButton}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={ScrollText}
        title="No entries yet"
        description="Logins, logouts, SOAP note changes, prescription sending and account suspensions show here."
      />
    );
  } else {
    body = (
      <>
        <div className={`hidden gap-4 border-b bg-muted px-6 py-3 text-sm font-medium text-muted-foreground xl:grid ${COLUMNS}`}>
          <span>Time</span>
          <span>User</span>
          <span>Action</span>
          <span>Details</span>
          <span>IP address</span>
        </div>
        <ul className="divide-y">
          {items.map((log) => (
            <LogRow key={log.logId} log={log} />
          ))}
        </ul>
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          noun={total === 1 ? "entry" : "entries"}
          onPageChange={(next) => setPaging({ key: filterKey, page: next })}
          disabled={logs.isFetching}
        />
      </>
    );
  }

  return (
    <PageTransition className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[2.25rem]">
          Audit log
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          Important actions in MediAssist AI, newest first. Entries cannot be edited or deleted.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[10.5rem_10.5rem_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="fromDate">From</Label>
          <Input
            id="fromDate"
            type="date"
            value={from}
            max={to || today()}
            onChange={(event) => setFrom(event.target.value)}
            aria-invalid={rangeError || undefined}
            aria-describedby={rangeError ? "dateRange-error" : undefined}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="toDate">To</Label>
          <Input
            id="toDate"
            type="date"
            value={to}
            min={from || undefined}
            max={today()}
            onChange={(event) => setTo(event.target.value)}
            aria-invalid={rangeError || undefined}
            aria-describedby={rangeError ? "dateRange-error" : undefined}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="userFilter">User</Label>
          <UserFilter id="userFilter" value={userId} onChange={setUserId} />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="actionFilter">Action</Label>
          <Select value={action} onValueChange={(next) => setAction(next as AuditAction | typeof ALL)}>
            <SelectTrigger id="actionFilter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ALL}>All actions</SelectItem>
              {ACTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {ACTION_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormError
          id="dateRange-error"
          message={rangeError ? "The From date must be on or before the To date." : undefined}
          className="sm:col-span-2 xl:col-span-4"
        />
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border bg-card">
        <div className="flex items-center justify-between gap-4 border-b px-4 py-5 sm:px-6">
          <h2 className="font-display text-lg font-bold tracking-tight">{filtered ? "Matching entries" : "All entries"}</h2>
          <span className="flex items-center gap-3">
            {logs.isFetching && !logs.isPending && <Spinner className="size-4" label="Loading" />}
            {logs.isSuccess && !rangeError && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground tabular-nums">
                {total} {total === 1 ? "entry" : "entries"}
              </span>
            )}
          </span>
        </div>
        {body}
      </div>
    </PageTransition>
  );
}

function LogRow({ log }: { log: AuditLog }) {
  const { user } = log;
  const name = user.fullName ?? `Unknown user (ID ${user.userId})`;

  return (
    <li className={`grid grid-cols-1 gap-1.5 px-4 py-4 sm:px-6 xl:items-center xl:gap-4 ${COLUMNS}`}>
      <p className="order-2 text-sm text-muted-foreground tabular-nums xl:order-none xl:text-foreground">
        <time dateTime={log.createdAt}>{formatDateTime(log.createdAt)}</time>
      </p>
      <div className="order-3 flex min-w-0 flex-wrap items-center gap-2 xl:order-none">
        {user.fullName ? (
          <Link
            href={`/admin/users/${user.userId}`}
            dir="auto"
            className="min-w-0 rounded-sm text-sm font-semibold break-words underline-offset-4 outline-none hover:underline focus-visible:ring-4 focus-visible:ring-ring/30"
          >
            {name}
          </Link>
        ) : (
          <span className="text-sm font-semibold">{name}</span>
        )}
        {user.role && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {ROLE_LABEL[user.role]}
          </span>
        )}
      </div>
      <p className="order-1 font-semibold xl:order-none xl:text-sm xl:font-medium">{ACTION_LABEL[log.action] ?? log.action}</p>
      <p className="order-4 text-sm break-words text-muted-foreground xl:order-none xl:text-foreground">
        {log.details ?? "No details"}
      </p>
      <p className="order-5 text-sm text-muted-foreground tabular-nums xl:order-none">
        <span className="xl:sr-only">IP address </span>
        {log.ipAddress}
      </p>
    </li>
  );
}
