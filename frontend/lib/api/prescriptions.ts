import { api } from "@/lib/api/client";
import type { Delivery, Paged, Prescription, SendOptions, SendPrescriptionResponse } from "@/lib/api/types";

export const prescriptionQueryKey = (consultationId: number) => ["prescriptions", "by-consultation", consultationId] as const;
export const sendOptionsQueryKey = (prescriptionId: number) => ["prescriptions", prescriptionId, "send-options"] as const;
export const deliveriesQueryKey = (prescriptionId: number) => ["prescriptions", prescriptionId, "deliveries"] as const;

// Prescription Service endpoints (design doc Section 5.7).
// Silent: the screens show these errors themselves.
export const prescriptionsApi = {
  // Saves a final copy of the prescription and makes its PDF.
  finalize: (consultationId: number) =>
    api<Prescription>("/prescriptions", { method: "POST", body: { consultationId }, silent: true }),

  // 404 PRESCRIPTION_NOT_FOUND while the prescription is not finalized yet.
  getByConsultation: (consultationId: number) =>
    api<Prescription>(`/prescriptions?consultationId=${consultationId}`, { silent: true }),

  downloadPdf: (prescriptionId: number) =>
    api<Blob>(`/prescriptions/${prescriptionId}/pdf`, { silent: true, responseType: "blob" }),

  getSendOptions: (prescriptionId: number) =>
    api<SendOptions>(`/prescriptions/${prescriptionId}/send-options`, { silent: true }),

  // The result comes later: check listDeliveries.
  sendByEmail: (prescriptionId: number) =>
    api<SendPrescriptionResponse>(`/prescriptions/${prescriptionId}/send`, {
      method: "POST",
      body: { channel: "email" },
      silent: true,
    }),

  listDeliveries: (prescriptionId: number) =>
    api<Paged<Delivery>>(`/prescriptions/${prescriptionId}/deliveries?page=1&pageSize=20`, { silent: true }),
};
