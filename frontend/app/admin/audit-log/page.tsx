import { Suspense } from "react";
import type { Metadata } from "next";
import { AuditLogList } from "./audit-log-list";

export const metadata: Metadata = { title: "Audit log" };

// Suspense: the user filter reads ?userId= from the URL.
export default function AuditLogPage() {
  return (
    <Suspense>
      <AuditLogList />
    </Suspense>
  );
}
