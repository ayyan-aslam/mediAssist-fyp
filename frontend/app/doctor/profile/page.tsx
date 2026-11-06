import type { Metadata } from "next";
import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "Profile" };

export default function DoctorProfilePage() {
  return <ProfileView />;
}
