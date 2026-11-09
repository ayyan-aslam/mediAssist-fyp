"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, UserRoundCheck, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { ADMIN_USERS_QUERY_KEY, adminApi, adminUserQueryKey } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AccountStatus, AdminUser, Paged } from "@/lib/api/types";

type Action = "suspend" | "activate";

const COPY: Record<Action, { button: string; confirm: string; busy: string; title: string; text: string; done: string }> = {
  suspend: {
    button: "Suspend",
    confirm: "Suspend account",
    busy: "Suspending…",
    title: "Suspend",
    text: "will be logged out on every device straight away, and cannot log in until you activate the account again.",
    done: "has been suspended.",
  },
  activate: {
    button: "Activate",
    confirm: "Activate account",
    busy: "Activating…",
    title: "Activate",
    text: "can log in and use MediAssist AI again straight away.",
    done: "has been activated.",
  },
};

// 409 ALREADY_SUSPENDED / ALREADY_ACTIVE: the account already has the status the admin wanted.
const ALREADY: Record<string, AccountStatus> = { ALREADY_SUSPENDED: "suspended", ALREADY_ACTIVE: "active" };

// Suspend or Activate with a confirm dialog that names the user (design doc 5.2 and Diagram 11).
// Admins (yourself included) cannot be suspended, so they get no button.
export function AccountAction({ user, className }: { user: AdminUser; className?: string }) {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  // Kept while the dialog is open, so its text does not change when the status does.
  const [action, setAction] = useState<Action | null>(null);

  // Updates the user in every loaded users page and on the detail page, without loading them again.
  const setStatus = (accountStatus: AccountStatus) => {
    const update = (item: AdminUser) => (item.userId === user.userId ? { ...item, accountStatus } : item);
    queryClient.setQueriesData<Paged<AdminUser>>(
      { queryKey: [...ADMIN_USERS_QUERY_KEY, "list"] },
      (data) => data && { ...data, items: data.items.map(update) },
    );
    queryClient.setQueryData<AdminUser>(adminUserQueryKey(user.userId), (data) => data && update(data));
  };

  const mutation = useMutation({
    mutationFn: (next: Action) =>
      next === "suspend" ? adminApi.suspendUser(user.userId) : adminApi.activateUser(user.userId),
    onSuccess: (result, next) => {
      setStatus(result.accountStatus);
      setAction(null);
      toast.success(`${user.fullName} ${COPY[next].done}`);
    },
    onError: (err) => {
      const status = err instanceof ApiError ? ALREADY[err.code] : undefined;
      if (!status) return;
      setStatus(status);
      setAction(null);
      toast.info(err.message);
    },
  });

  if (user.role === "admin" || user.userId === me?.userId) return null;

  const current: Action = user.accountStatus === "active" ? "suspend" : "activate";
  const shown = action ?? current;
  const copy = COPY[shown];

  const open = (next: Action) => {
    mutation.reset();
    setAction(next);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => open(current)}
        aria-label={`${COPY[current].button} ${user.fullName}`}
        className={current === "suspend" ? `text-destructive ${className ?? ""}` : className}
      >
        {current === "suspend" ? (
          <UserRoundX aria-hidden="true" data-icon="inline-start" />
        ) : (
          <UserRoundCheck aria-hidden="true" data-icon="inline-start" />
        )}
        {COPY[current].button}
      </Button>

      <Dialog
        open={action !== null}
        onOpenChange={(next) => {
          if (!next && !mutation.isPending) setAction(null);
        }}
      >
        <DialogContent showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle className="break-words">
              {copy.title} {user.fullName}?
            </DialogTitle>
            <DialogDescription>
              {user.fullName} ({user.email}) {copy.text}
            </DialogDescription>
          </DialogHeader>

          {mutation.isError && !(mutation.error instanceof ApiError && ALREADY[mutation.error.code]) && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              variant={shown === "suspend" ? "destructive" : "default"}
              onClick={() => mutation.mutate(shown)}
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Spinner className="size-4 text-current" label={copy.busy} />}
              {mutation.isPending ? copy.busy : copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
