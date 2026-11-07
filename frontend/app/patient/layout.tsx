import { RequireAuth } from "@/components/shared/require-auth";

export default function PatientLayout({ children }: LayoutProps<"/patient">) {
  return <RequireAuth role="patient">{children}</RequireAuth>;
}
