"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleAlert, RotateCw, ScrollText, UserRoundSearch } from "lucide-react";
import { AccountStatusChip } from "@/components/shared/account-status";
import { EmptyState } from "@/components/shared/empty-state";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi, adminUserQueryKey } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminUser } from "@/lib/api/types";
import { formatDate, initials, ROLE_LABEL } from "@/lib/format";
import { AccountAction } from "../account-action";

export function UserDetail() {
  const params = useParams<{ id: string }>();
  const userId = /^\d+$/.test(params.id) ? Number(params.id) : null;

  const user = useQuery({
    queryKey: adminUserQueryKey(userId ?? 0),
    queryFn: () => adminApi.getUser(userId!),
    enabled: userId !== null,
  });

  let content: React.ReactNode;
  if (userId === null || (user.error instanceof ApiError && user.error.status === 404)) {
    content = (
      <div className="mx-auto max-w-xl rounded-[1.5rem] border bg-card">
        <EmptyState
          icon={UserRoundSearch}
          title="User not found"
          description="This user does not exist. Go back to the list and search again."
          action={
            <Button asChild size="lg">
              <Link href="/admin/users">All users</Link>
            </Button>
          }
        />
      </div>
    );
  } else if (user.isError) {
    content = (
      <div className="max-w-2xl rounded-[1.5rem] border bg-card p-6 sm:p-8">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The user could not be loaded. {user.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => user.refetch()} disabled={user.isFetching}>
          {user.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </div>
    );
  } else if (user.isPending) {
    content = <UserCardSkeleton />;
  } else {
    content = <UserCard user={user.data} />;
  }

  return (
    <PageTransition className="space-y-6">
      <Button asChild variant="ghost" className="-ml-3">
        <Link href="/admin/users">
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          All users
        </Link>
      </Button>
      {content}
    </PageTransition>
  );
}

function UserCard({ user }: { user: AdminUser }) {
  const details: [string, React.ReactNode][] = [
    ["Email", <span key="email" className="break-all">{user.email}</span>],
    ["Phone", user.phone ? <span key="phone" className="tabular-nums">{user.phone}</span> : "Not given"],
    ["Role", ROLE_LABEL[user.role]],
    ...(user.role === "doctor" ? [["Speciality", user.specialty?.name ?? "Not chosen"] as [string, React.ReactNode]] : []),
    ["Joined", formatDate(user.createdAt)],
    ["User ID", <span key="id" className="tabular-nums">{user.userId}</span>],
  ];

  return (
    <section aria-labelledby="user-name" className="max-w-3xl rounded-[1.5rem] border bg-card p-6 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-mint font-display text-xl font-bold text-mint-foreground sm:size-16 sm:text-2xl"
          >
            {initials(user.fullName)}
          </span>
          <div className="min-w-0 space-y-1.5">
            <h1
              id="user-name"
              dir="auto"
              className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] break-words sm:text-[2.25rem]"
            >
              {user.fullName}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {ROLE_LABEL[user.role]}
              </span>
              <AccountStatusChip status={user.accountStatus} />
            </div>
          </div>
        </div>
        <AccountAction user={user} className="self-start" />
      </div>

      {user.accountStatus === "suspended" && (
        <Alert className="mt-6 border-highlight/60 bg-peach text-peach-foreground">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="text-peach-foreground">
            This account is suspended. The user cannot log in until you activate it again.
          </AlertDescription>
        </Alert>
      )}

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-t pt-6 sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 border-t pt-6">
        <Button asChild variant="outline">
          <Link href={`/admin/audit-log?userId=${user.userId}`}>
            <ScrollText aria-hidden="true" data-icon="inline-start" />
            See this user’s audit log
          </Link>
        </Button>
      </div>
    </section>
  );
}

function UserCardSkeleton() {
  return (
    <div className="max-w-3xl rounded-[1.5rem] border bg-card p-6 sm:p-8" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full sm:size-16" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-5 w-48 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
