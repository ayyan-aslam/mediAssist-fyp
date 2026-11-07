import type { Gender } from "@/lib/api/types";

export const GENDER_LABEL: Record<Gender, string> = { male: "Male", female: "Female", other: "Other" };

// First and last initial of a name, for the avatar circle.
export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
}

// A YYYY-MM-DD date or an ISO time (design doc 5.1.1) as "7 October 2026".
// A YYYY-MM-DD date is read as a local date, so it never shifts a day.
export function formatDate(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(value);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// The first non-empty line of a text, or null.
export function firstLine(text: string | null) {
  return text?.split("\n").find((line) => line.trim() !== "")?.trim() ?? null;
}
