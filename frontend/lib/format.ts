import type { Gender, Role } from "@/lib/api/types";

export const GENDER_LABEL: Record<Gender, string> = { male: "Male", female: "Female", other: "Other" };

export const ROLE_LABEL: Record<Role, string> = { patient: "Patient", doctor: "Doctor", admin: "Admin" };

// First and last initial of a name, for the avatar circle. A leading "Dr" title is skipped.
export function initials(name: string) {
  const parts = name.trim().replace(/^Dr\.?\s+/i, "").split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
}

// A YYYY-MM-DD date or an ISO time (design doc 5.1.1) as "7 October 2026".
// A YYYY-MM-DD date is read as a local date, so it never shifts a day.
export function formatDate(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(value);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// An ISO time as "7 Oct 2026", for table columns.
export function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// An ISO time as "7 Oct 2026, 14:41" in the browser's time zone.
export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The first non-empty line of a text, or null.
export function firstLine(text: string | null) {
  return text?.split("\n").find((line) => line.trim() !== "")?.trim() ?? null;
}
