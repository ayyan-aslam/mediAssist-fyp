import { FileText, LayoutDashboard, UserRound, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Shown but not clickable until its screen is built.
  soon?: boolean;
}

export type Area = "doctor";

// Side menu of each area (the first item is the area home). Phase 0 builds only the doctor area.
export const navByArea: Record<Area, NavItem[]> = {
  doctor: [
    { href: "/doctor", label: "Home", icon: LayoutDashboard },
    { href: "/doctor/patients", label: "Patients", icon: Users, soon: true },
    { href: "/doctor/soap-notes", label: "SOAP notes", icon: FileText, soon: true },
    { href: "/doctor/profile", label: "Profile", icon: UserRound, soon: true },
  ],
};
