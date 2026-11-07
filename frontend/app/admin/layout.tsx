import { RequireAuth } from "@/components/shared/require-auth";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <RequireAuth role="admin">{children}</RequireAuth>;
}
