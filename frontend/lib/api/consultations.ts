import { api } from "@/lib/api/client";
import type {
  ClinicalPatient,
  CreateClinicalPatientRequest,
  FindClinicalPatientResponse,
  StartConsultationResponse,
  UpdateClinicalPatientRequest,
} from "@/lib/api/types";

export const patientByPhoneQueryKey = (phone: string) => ["clinical-patients", "by-phone", phone] as const;

// Consultation Service endpoints (design doc Section 5.5).
// Silent: the screens show these errors themselves (next to the field, or as a toast).
export const consultationsApi = {
  findPatientByPhone: (phone: string) =>
    api<FindClinicalPatientResponse>(`/clinical-patients?phone=${encodeURIComponent(phone)}`, { silent: true }),

  createPatient: (body: CreateClinicalPatientRequest) =>
    api<ClinicalPatient>("/clinical-patients", { method: "POST", body, silent: true }),

  // Send only the fields that changed.
  updatePatient: (patientId: number, body: UpdateClinicalPatientRequest) =>
    api<ClinicalPatient>(`/clinical-patients/${patientId}`, { method: "PATCH", body, silent: true }),

  start: (clinicalPatientId: number) =>
    api<StartConsultationResponse>("/consultations", { method: "POST", body: { clinicalPatientId }, silent: true }),
};
