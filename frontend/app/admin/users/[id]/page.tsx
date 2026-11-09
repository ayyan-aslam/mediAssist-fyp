import type { Metadata } from "next";
import { UserDetail } from "./user-detail";

export const metadata: Metadata = { title: "User" };

export default function UserPage() {
  return <UserDetail />;
}
