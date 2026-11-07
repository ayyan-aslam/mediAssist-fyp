import { api } from "@/lib/api/client";
import type { DoctorProfile, Specialty, UpdateDoctorProfileRequest } from "@/lib/api/types";

export const PROFILE_QUERY_KEY = ["users", "me"] as const;
export const SPECIALTIES_QUERY_KEY = ["specialties"] as const;

// Auth & User Service profile endpoints (design doc Section 5.2).
// Silent: the profile page shows these errors itself (error state, or next to the field).
export const usersApi = {
  getMe: () => api<DoctorProfile>("/users/me", { silent: true }),

  // Send only the fields that changed.
  updateMe: (body: UpdateDoctorProfileRequest) =>
    api<DoctorProfile>("/users/me", { method: "PATCH", body, silent: true }),

  listSpecialties: () => api<{ items: Specialty[] }>("/specialties", { auth: false, silent: true }),
};
