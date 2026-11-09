import { AppShell } from "@/components/shared/app-shell";
import { RequireAuth } from "@/components/shared/require-auth";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <RequireAuth role="admin">
      <AppShell area="admin">{children}</AppShell>
    </RequireAuth>
  );
}
