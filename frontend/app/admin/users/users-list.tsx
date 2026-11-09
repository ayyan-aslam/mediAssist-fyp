"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlert, RotateCw, Search, SearchX, Users, X } from "lucide-react";
import { AccountStatusChip } from "@/components/shared/account-status";
import { EmptyState } from "@/components/shared/empty-state";
import { Highlight } from "@/components/shared/highlight";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageTransition } from "@/components/shared/page-transition";
import { Pager } from "@/components/shared/pager";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MIN_SEARCH_LENGTH, useSearchParam } from "@/hooks/use-search-param";
import { adminApi, adminUsersQueryKey, type AdminUserFilters } from "@/lib/api/admin";
import type { AdminUser } from "@/lib/api/types";
import { formatShortDate, initials, ROLE_LABEL } from "@/lib/format";
import { AccountAction } from "./account-action";

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
// "all" stands for no filter (a Select item cannot have an empty value).
const ALL = "all";
// The full table needs the width of an xl screen; below that each user is a small card.
const COLUMNS =
  "xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_7.5rem_4.5rem_5.5rem_6.5rem_7rem]";

const ROLE_OPTIONS = [
  { value: ALL, label: "All roles" },
  { value: "doctor", label: "Doctors" },
  { value: "patient", label: "Patients" },
  { value: "admin", label: "Admins" },
] as const;

const STATUS_OPTIONS = [
  { value: ALL, label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const;

type RoleFilter = (typeof ROLE_OPTIONS)[number]["value"];
type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

export function UsersList() {
  const { input, setInput, query, tooShort, typing } = useSearchParam(SEARCH_DELAY_MS);
  const [role, setRole] = useState<RoleFilter>(ALL);
  const [status, setStatus] = useState<StatusFilter>(ALL);

  // The page goes back to 1 whenever the search or a filter changes.
  const filterKey = `${query}|${role}|${status}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;

  const filters: AdminUserFilters = {
    search: query || undefined,
    role: role === ALL ? undefined : role,
    status: status === ALL ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  };
  const users = useQuery({
    queryKey: adminUsersQueryKey(filters),
    queryFn: () => adminApi.listUsers(filters),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(query) || role !== ALL || status !== ALL;
  const items = users.data?.items ?? [];
  const total = users.data?.total ?? 0;
  const searching = (typing && !tooShort) || (users.isPlaceholderData && users.isFetching);

  const clearAll = () => {
    setInput("");
    setRole(ALL);
    setStatus(ALL);
  };

  let body: React.ReactNode;
  if (users.isPending) {
    body = <ListSkeleton />;
  } else if (users.isError) {
    body = (
      <div className="p-6">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The users could not be loaded. {users.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => users.refetch()} disabled={users.isFetching}>
          {users.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0 && filtered) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No users found"
        description={
          query
            ? `No user with these filters has “${query}” in their name, email or phone number.`
            : "No user matches these filters."
        }
        action={
          <Button variant="outline" onClick={clearAll}>
            <X aria-hidden="true" data-icon="inline-start" />
            Clear search and filters
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    body = <EmptyState icon={Users} title="No users yet" description="Patients and doctors show here after they sign up." />;
  } else {
    body = (
      <>
        <div
          className={`hidden gap-4 border-b bg-muted px-6 py-3 text-sm font-medium text-muted-foreground xl:grid ${COLUMNS}`}
        >
          <span>Name</span>
          <span>Email</span>
          <span>Phone</span>
          <span>Role</span>
          <span>Status</span>
          <span>Joined</span>
          <span className="sr-only">Action</span>
        </div>
        <ul className="divide-y">
          {items.map((user) => (
            <UserRow key={user.userId} user={user} query={query} />
          ))}
        </ul>
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          noun={total === 1 ? "user" : "users"}
          onPageChange={(next) => setPaging({ key: filterKey, page: next })}
          disabled={users.isFetching}
        />
      </>
    );
  }

  return (
    <PageTransition className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[2.25rem]">
          Users
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          Find a patient or doctor, open their details, and suspend or activate their account.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem]">
        <div className="space-y-2 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="userSearch">Search by name, email or phone</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="userSearch"
              type="search"
              autoComplete="off"
              placeholder="For example Sara or 0311"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="pr-12 pl-12 [&::-webkit-search-cancel-button]:hidden"
              aria-describedby="userSearch-hint"
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
          <p id="userSearch-hint" className="text-sm text-muted-foreground" aria-live="polite">
            {tooShort ? `Type at least ${MIN_SEARCH_LENGTH} characters.` : "Part of the name, email or phone is enough."}
          </p>
        </div>

        <FilterSelect id="roleFilter" label="Role" value={role} options={ROLE_OPTIONS} onChange={setRole} />
        <FilterSelect id="statusFilter" label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border bg-card">
        <div className="flex items-center justify-between gap-4 border-b px-4 py-5 sm:px-6">
          <h2 className="font-display text-lg font-bold tracking-tight">{filtered ? "Matching users" : "All users"}</h2>
          {users.isSuccess && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground tabular-nums">
              {total} {total === 1 ? "user" : "users"}
            </span>
          )}
        </div>
        {body}
      </div>
    </PageTransition>
  );
}

function FilterSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function UserRow({ user, query }: { user: AdminUser; query: string }) {
  const phone = user.phone ? <Highlight text={user.phone} query={query} /> : "No phone";

  return (
    <li className={`grid grid-cols-1 gap-3 px-4 py-4 sm:px-6 xl:items-center xl:gap-4 ${COLUMNS}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-sm font-bold text-secondary-foreground"
        >
          {initials(user.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/admin/users/${user.userId}`}
              dir="auto"
              className="min-w-0 rounded-sm font-semibold break-words underline-offset-4 outline-none hover:underline focus-visible:ring-4 focus-visible:ring-ring/30"
            >
              <Highlight text={user.fullName} query={query} />
            </Link>
            <AccountStatusChip status={user.accountStatus} className="xl:hidden" />
          </div>
          <p className="text-sm break-all text-muted-foreground xl:hidden">
            <Highlight text={user.email} query={query} />
          </p>
        </div>
      </div>

      <p className="hidden text-sm break-all xl:block">
        <Highlight text={user.email} query={query} />
      </p>
      <p className="hidden text-sm tabular-nums xl:block">{phone}</p>
      <p className="hidden text-sm xl:block">{ROLE_LABEL[user.role]}</p>
      <div className="hidden xl:block">
        <AccountStatusChip status={user.accountStatus} />
      </div>
      <p className="hidden text-sm text-muted-foreground xl:block">{formatShortDate(user.createdAt)}</p>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-13 xl:justify-end xl:pl-0">
        <p className="text-sm text-muted-foreground xl:hidden">
          {ROLE_LABEL[user.role]} · <span className="whitespace-nowrap tabular-nums">{phone}</span> ·{" "}
          <span className="whitespace-nowrap">Joined {formatShortDate(user.createdAt)}</span>
        </p>
        <AccountAction user={user} />
      </div>
    </li>
  );
}
