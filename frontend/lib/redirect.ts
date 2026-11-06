import type { Role } from "@/lib/api/types";

// The login page, with the current page (path and query) to come back to after login.
export function loginHref() {
  const next = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

// After login: the page the user wanted if it is in their own area, otherwise their area home.
// Only paths inside the area are accepted, so ?next= cannot send the user to another site.
export function afterLoginHref(next: string | null, role: Role) {
  const home = `/${role}`;
  const inArea = next !== null && (next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`));
  return inArea ? next : home;
}
