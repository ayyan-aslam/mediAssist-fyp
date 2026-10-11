import { api } from "@/lib/api/client";
import type { DoctorRegisterRequest, LoginResponse, RegisterResponse } from "@/lib/api/types";

// Auth & User Service endpoints (design doc Section 5.2).
// Sign-up and login are silent: their forms show the error next to the right field.
export const authApi = {
  registerDoctor: (body: DoctorRegisterRequest) =>
    api<RegisterResponse>("/auth/doctor/register", { method: "POST", body, auth: false, silent: true }),

  login: (firebaseToken: string) =>
    api<LoginResponse>("/auth/login", { method: "POST", body: { firebaseToken }, auth: false, silent: true }),

  logout: (refreshToken: string) =>
    api<void>("/auth/logout", { method: "POST", body: { refreshToken }, silent: true }),
};
