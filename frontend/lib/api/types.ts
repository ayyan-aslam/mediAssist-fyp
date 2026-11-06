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

// GET /users/me for a doctor. The CNIC is never sent back.
export interface DoctorProfile {
  userId: number;
  fullName: string;
  email: string;
  phone: string | null;
  role: "doctor";
  registrationNo: string;
  specialty: Specialty | null;
}

// PATCH /users/me for a doctor: only the fields that changed.
export interface UpdateDoctorProfileRequest {
  fullName?: string;
  phone?: string;
  specialtyId?: number | null;
}

// Consultation Service (design doc Section 5.5).

export type Gender = "male" | "female" | "other";

// The clinic patient object.
export interface ClinicalPatient {
  clinicalPatientId: number;
  fullName: string;
  phone: string;
  email: string | null;
  age: number;
  gender: Gender;
  createdAt: string;
}

// GET /clinical-patients?phone=
export type FindClinicalPatientResponse =
  | { found: true; patient: ClinicalPatient }
  | { found: false; patient: null };

export interface CreateClinicalPatientRequest {
  fullName: string;
  phone: string;
  email: string | null;
  age: number;
  gender: Gender;
}

// PATCH /clinical-patients/{patientId}: only the fields that changed.
export type UpdateClinicalPatientRequest = Partial<CreateClinicalPatientRequest>;

// POST /consultations
export interface StartConsultationResponse {
  consultationId: number;
  status: "recording";
  startedAt: string;
}
