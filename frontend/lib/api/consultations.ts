import { api } from "@/lib/api/client";
import type {
  AudioPartResponse,
  ClinicalPatient,
  Consultation,
  CreateClinicalPatientRequest,
  FindClinicalPatientResponse,
  FinishEditingResponse,
  Paged,
  PatientSoapNoteItem,
  RetryConsultationResponse,
  SoapNote,
  SoapNoteChanges,
  SoapNoteListItem,
  StartConsultationResponse,
  StopConsultationResponse,
  UpdateClinicalPatientRequest,
  UpdateSoapNoteResponse,
} from "@/lib/api/types";

export const consultationQueryKey = (consultationId: number) => ["consultations", consultationId] as const;
export const patientByPhoneQueryKey = (phone: string) => ["clinical-patients", "by-phone", phone] as const;
export const patientQueryKey = (patientId: number) => ["clinical-patients", patientId] as const;
export const patientsQueryKey = (q: string) => ["clinical-patients", "list", q] as const;
export const patientSoapNotesQueryKey = (patientId: number) => ["clinical-patients", patientId, "soap-notes"] as const;
export const recentSoapNotesQueryKey = ["soap-notes", "recent"] as const;
export const soapNoteSearchQueryKey = (q: string) => ["soap-notes", "search", q] as const;
export const soapNoteQueryKey = (consultationId: number) => ["consultations", consultationId, "soap-note"] as const;

const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (value === undefined || value === "" ? [] : [[key, String(value)]])),
  ).toString();

// Consultation Service endpoints (design doc Section 5.5).
// Silent: the screens show these errors themselves (next to the field, or as a toast).
export const consultationsApi = {
  findPatientByPhone: (phone: string) =>
    api<FindClinicalPatientResponse>(`/clinical-patients?phone=${encodeURIComponent(phone)}`, { silent: true }),

  createPatient: (body: CreateClinicalPatientRequest) =>
    api<ClinicalPatient>("/clinical-patients", { method: "POST", body, silent: true }),

  // The doctor's patients, newest first. q (at least 2 characters) filters by name or phone.
  listPatients: ({ q, page, pageSize }: { q?: string; page: number; pageSize: number }) =>
    api<Paged<ClinicalPatient>>(`/clinical-patients?${query({ q, page, pageSize })}`, { silent: true }),

  // Every consultation of the patient, newest first.
  listPatientSoapNotes: (patientId: number, { page, pageSize }: { page: number; pageSize: number }) =>
    api<Paged<PatientSoapNoteItem>>(`/clinical-patients/${patientId}/soap-notes?${query({ page, pageSize })}`, {
      silent: true,
    }),

  // The doctor's latest SOAP notes, newest first.
  listRecentSoapNotes: (pageSize: number) =>
    api<Paged<SoapNoteListItem>>(`/soap-notes?${query({ page: 1, pageSize })}`, { silent: true }),

  // By part of the patient's name or phone (at least 2 characters).
  searchSoapNotes: ({ q, page, pageSize }: { q: string; page: number; pageSize: number }) =>
    api<Paged<SoapNoteListItem>>(`/soap-notes/search?${query({ q, page, pageSize })}`, { silent: true }),

  getPatient: (patientId: number) => api<ClinicalPatient>(`/clinical-patients/${patientId}`, { silent: true }),

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

  // After a failure: the next attempt, without recording again.
  retry: (consultationId: number) =>
    api<RetryConsultationResponse>(`/consultations/${consultationId}/retry`, { method: "POST", silent: true }),

  // Opening the note starts the editing session.
  getSoapNote: (consultationId: number) =>
    api<SoapNote>(`/consultations/${consultationId}/soap-note`, { silent: true }),

  // Auto-save: send only the parts that changed. keepalive when the page is being closed.
  updateSoapNote: (consultationId: number, changes: SoapNoteChanges, { keepalive = false } = {}) =>
    api<UpdateSoapNoteResponse>(`/consultations/${consultationId}/soap-note`, {
      method: "PATCH",
      body: changes,
      silent: true,
      keepalive,
    }),

  // Ends the editing session (Save, or leaving the page). keepalive when the page is being closed.
  finishEditing: (consultationId: number, { keepalive = false } = {}) =>
    api<FinishEditingResponse>(`/consultations/${consultationId}/soap-note/finish-editing`, {
      method: "POST",
      silent: true,
      keepalive,
    }),
};
