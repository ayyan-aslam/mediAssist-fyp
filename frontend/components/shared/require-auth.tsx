"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FullPageSpinner } from "@/components/shared/spinner";
import { useAuth } from "@/hooks/use-auth";
import type { Role } from "@/lib/api/types";
import { loginHref } from "@/lib/redirect";

// Shows the children only to a logged-in user with the given role.
// Not logged in: goes to /login (and back to this page after login). Other role: goes to that role's home.
export function RequireAuth({ role, children }: { role: Role; children: React.ReactNode }) {
  const { user, status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace(loginHref());
    else if (user && user.role !== role) router.replace(`/${user.role}`);
  }, [status, user, role, router]);

  if (status !== "authenticated" || user?.role !== role) return <FullPageSpinner />;
  return children;
}
