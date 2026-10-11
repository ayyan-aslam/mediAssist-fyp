import { AppShell } from "@/components/shared/app-shell";
import { RequireAuth } from "@/components/shared/require-auth";

export default function DoctorLayout({ children }: LayoutProps<"/doctor">) {
  return (
    <RequireAuth role="doctor">
      <AppShell area="doctor">{children}</AppShell>
    </RequireAuth>
  );
}
