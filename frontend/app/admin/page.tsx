import { redirect } from "next/navigation";

// The admin home is the users list.
export default function AdminHomePage() {
  redirect("/admin/users");
}
