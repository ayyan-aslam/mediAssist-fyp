import { AppShell } from "@/components/shared/app-shell";
import { RequireAuth } from "@/components/shared/require-auth";
import { ConsultationEventsProvider } from "@/context/consultation-events-context";

export default function DoctorLayout({ children }: LayoutProps<"/doctor">) {
  return (
    <RequireAuth role="doctor">
      <ConsultationEventsProvider>
        <AppShell area="doctor">{children}</AppShell>
      </ConsultationEventsProvider>
    </RequireAuth>
  );
}
