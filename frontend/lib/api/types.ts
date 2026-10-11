// Shapes from design doc Section 5.

export type Role = "patient" | "doctor" | "admin";

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// The user returned by POST /auth/login.
export interface SessionUser {
  userId: number;
  fullName: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterResponse {
  userId: number;
  message: string;
}

export interface DoctorRegisterRequest {
  fullName: string;
  email: string;
  phone: string;
  cnic: string;
  registrationNo: string;
  password: string;
  confirmPassword: string;
}

export interface Specialty {
  specialtyId: number;
  name: string;
}
