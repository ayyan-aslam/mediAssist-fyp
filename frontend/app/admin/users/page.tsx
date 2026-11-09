import { Suspense } from "react";
import type { Metadata } from "next";
import { UsersList } from "./users-list";

export const metadata: Metadata = { title: "Users" };

// Suspense: the search box reads ?q= from the URL.
export default function UsersPage() {
  return (
    <Suspense>
      <UsersList />
    </Suspense>
  );
}
