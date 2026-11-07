// Shapes from design doc Section 5.

export type Role = "patient" | "doctor" | "admin";

// Some errors carry extra fields, like `missingParts` of 409 PARTS_MISSING.
export interface ApiErrorBody {
  error: { code: string; message: string; [field: string]: unknown };
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

export type ConsultationStatus = "recording" | "processing" | "completed" | "failed";

// NO_SPEECH: the transcript was empty (silence or a very short recording), so it must be recorded again.
export type FailureReason = "TRANSCRIPTION_FAILED" | "AI_FAILED" | "AI_TIMEOUT" | "NO_SPEECH";

// GET /consultations/{consultationId}
export interface Consultation {
  consultationId: number;
  patient: { clinicalPatientId: number; fullName: string; phone: string };
  status: ConsultationStatus;
  failureReason: FailureReason | null;
  followUpDate: string | null;
  startedAt: string;
  endedAt: string | null;
}

// POST /consultations/{consultationId}/audio-parts (201 new part, 200 already saved)
export interface AudioPartResponse {
  partNo: number;
  saved: true;
}

// POST /consultations/{consultationId}/stop
export interface StopConsultationResponse {
  consultationId: number;
  status: "processing";
  endedAt: string;
}

// POST /consultations/{consultationId}/retry
export interface RetryConsultationResponse {
  consultationId: number;
  status: "processing";
}

// GET /consultations/{consultationId}/soap-note
export interface SoapNote {
  soapNoteId: number;
  consultationId: number;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  updatedAt: string;
  // What the AI Pipeline found, shown next to the note. null for a note without an AI answer.
  aiInsights: AiInsights | null;
}

// symptoms and prescription are the doctor's edited lists when *Edited is true, else the AI's.
export interface AiInsights {
  symptoms: AiSymptom[];
  symptomsEdited: boolean;
  prescription: AiMedicine[];
  prescriptionEdited: boolean;
  forDoctorReview: AiMedicine[];
  medicationHistory: AiMedicationHistory[];
  warnings: AiWarning[];
}

export interface AiSymptom {
  // Position of the AI symptom it came from; null for one the doctor added.
  aiIndex: number | null;
  symptom: string | null;
  mention: string | null;
  // The transcript line the symptom was found in.
  sourceText: string | null;
  // Symptom labels of the medicine datasets it matched.
  matchedLabels: string[];
}

export interface AiMedicine {
  // Position of the AI medicine it came from; null for one the doctor added.
  aiIndex: number | null;
  // Position in forDoctorReview: for a suggestion, and for a prescribed medicine the doctor accepted from one.
  reviewIndex: number | null;
  name: string | null;
  genericName: string | null;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  instructions: string | null;
  // matched: found in the datasets; rag_only: a dataset suggestion; doctor_added: added or renamed by
  // the doctor; anything else: not found.
  matchStatus: string | null;
  linkedSymptoms: string[];
  // Why the AI suggests it (only for forDoctorReview).
  suggestionReason: string | null;
  info: AiMedicineInfo | null;
}

// From the Dawaai and DVAGO datasets. When both have text, it is labelled "Dawaai:" and "DVAGO:".
export interface AiMedicineInfo {
  indication: string | null;
  sideEffects: string | null;
  contraindications: string | null;
  warnings: string | null;
  precautions: string | null;
  drugInteractions: string | null;
  dosageReference: string | null;
  howToUse: string | null;
  mechanism: string | null;
  matchedProducts: string[];
  sources: string[];
  urls: string[];
}

export interface AiMedicationHistory {
  medicineName: string | null;
  condition: string | null;
  duration: string | null;
  frequency: string | null;
  status: string | null;
  sourceText: string | null;
}

export interface AiWarning {
  section: string | null;
  message: string | null;
  detail: string | null;
}

export type SoapPart = "subjective" | "objective" | "assessment" | "plan";

// PATCH /consultations/{consultationId}/soap-note: only the parts that changed. A null prescription or
// symptoms list goes back to the AI version.
export type SoapNoteChanges = Partial<Record<SoapPart, string>> & {
  prescription?: PrescriptionEdit[] | null;
  symptoms?: SymptomEdit[] | null;
};

export interface PrescriptionEdit {
  aiIndex: number | null;
  reviewIndex: number | null;
  name: string;
  genericName: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
}

export interface SymptomEdit {
  aiIndex: number | null;
  symptom: string;
}

export interface UpdateSoapNoteResponse {
  updatedAt: string;
}

// POST /consultations/{consultationId}/soap-note/finish-editing
export interface FinishEditingResponse {
  changed: boolean;
}

// GET /clinical-patients/{patientId}/soap-notes: every consultation of the patient.
// assessment is null while the consultation has no SOAP note.
export interface PatientSoapNoteItem {
  consultationId: number;
  date: string;
  status: ConsultationStatus;
  assessment: string | null;
}

// GET /soap-notes and GET /soap-notes/search
export interface SoapNoteListItem {
  consultationId: number;
  date: string;
  patient: { clinicalPatientId: number; fullName: string; phone: string };
}

// GET /consultations/events (SSE): the data line of each event.
export type ConsultationEvent =
  | { event: "soap_ready"; data: { consultationId: number } }
  | {
      event: "consultation_failed";
      data: { consultationId: number; failureReason: FailureReason; message: string };
    };
