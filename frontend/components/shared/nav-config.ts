import { CirclePlus, LayoutDashboard, Search, UserRound, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Shown but not clickable until its screen is built.
  soon?: boolean;
}

export type Area = "doctor";

export const NEW_CONSULTATION_HREF = "/doctor/consultations/new";

// Side menu of each area (the first item is the area home). Only the doctor area has a menu so far.
export const navByArea: Record<Area, NavItem[]> = {
  doctor: [
    { href: "/doctor", label: "Home", icon: LayoutDashboard },
    { href: NEW_CONSULTATION_HREF, label: "New consultation", icon: CirclePlus },
    { href: "/doctor/patients", label: "Patients & notes", icon: Users },
    { href: "/doctor/search", label: "Search", icon: Search },
    { href: "/doctor/profile", label: "Profile", icon: UserRound },
  ],
};
