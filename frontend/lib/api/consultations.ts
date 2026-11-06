import { api } from "@/lib/api/client";
import type {
  AudioPartResponse,
  ClinicalPatient,
  Consultation,
  CreateClinicalPatientRequest,
  FindClinicalPatientResponse,
  StartConsultationResponse,
  StopConsultationResponse,
  UpdateClinicalPatientRequest,
} from "@/lib/api/types";

export const consultationQueryKey = (consultationId: number) => ["consultations", consultationId] as const;
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

  get: (consultationId: number) => api<Consultation>(`/consultations/${consultationId}`, { silent: true }),

  // One 10-second part as multipart/form-data: audio, partNo, durationSec.
  uploadPart: (consultationId: number, part: { partNo: number; durationSec: number; audio: Blob }) => {
    const form = new FormData();
    form.append("audio", part.audio, `${part.partNo}.webm`);
    form.append("partNo", String(part.partNo));
    form.append("durationSec", String(part.durationSec));
    return api<AudioPartResponse>(`/consultations/${consultationId}/audio-parts`, {
      method: "POST",
      body: form,
      silent: true,
    });
  },

  stop: (consultationId: number, totalParts: number) =>
    api<StopConsultationResponse>(`/consultations/${consultationId}/stop`, {
      method: "POST",
      body: { totalParts },
      silent: true,
    }),
};
