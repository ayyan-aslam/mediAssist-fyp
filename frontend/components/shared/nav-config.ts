import { CirclePlus, LayoutDashboard, ScrollText, Search, UserRound, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Shown but not clickable until its screen is built.
  soon?: boolean;
  // Active only on its own path, not on the pages below it (for an area home).
  exact?: boolean;
}

export type Area = "doctor" | "admin";

export const NEW_CONSULTATION_HREF = "/doctor/consultations/new";

// Side menu of each area (the first item is the area home).
export const navByArea: Record<Area, NavItem[]> = {
  doctor: [
    { href: "/doctor", label: "Home", icon: LayoutDashboard, exact: true },
    { href: NEW_CONSULTATION_HREF, label: "New consultation", icon: CirclePlus },
    { href: "/doctor/patients", label: "Patients & notes", icon: Users },
    { href: "/doctor/search", label: "Search", icon: Search },
    { href: "/doctor/profile", label: "Profile", icon: UserRound },
  ],
  admin: [
    { href: "/admin/users", label: "Users", icon: Users },
    { href: "/admin/audit-log", label: "Audit log", icon: ScrollText },
  ],
};
