"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FullPageSpinner } from "@/components/shared/spinner";
import { useAuth } from "@/hooks/use-auth";
import type { Role } from "@/lib/api/types";

// Shows the children only to a logged-in user with the given role.
// Not logged in: goes to /login (and back here after login). Other role: goes to that role's home.
export function RequireAuth({ role, children }: { role: Role; children: React.ReactNode }) {
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (user && user.role !== role) router.replace(`/${user.role}`);
  }, [status, user, role, router, pathname]);

  if (status !== "authenticated" || user?.role !== role) return <FullPageSpinner />;
  return children;
}
