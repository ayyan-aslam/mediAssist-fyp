"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { FullPageSpinner } from "@/components/shared/spinner";
import { useAuth } from "@/hooks/use-auth";
import { getRefreshToken } from "@/lib/api/tokens";
import { afterLoginHref } from "@/lib/redirect";

const noSubscribe = () => () => {};

// For the landing and auth pages: a logged-in user goes to their area (or to ?next= inside it).
// While a saved session is being restored, a spinner covers the page so it does not flash.
export function RedirectIfAuthenticated() {
  const { user, status } = useAuth();
  const router = useRouter();
  // False on the server and during hydration, so both renders match.
  const hasSavedSession = useSyncExternalStore(
    noSubscribe,
    () => getRefreshToken() !== null,
    () => false,
  );

  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(afterLoginHref(next, user.role));
  }, [status, user, router]);

  const covered = status === "authenticated" || (status === "loading" && hasSavedSession);
  if (!covered) return null;
  return (
    <div className="fixed inset-0 z-50 bg-background">
      <FullPageSpinner />
    </div>
  );
}
