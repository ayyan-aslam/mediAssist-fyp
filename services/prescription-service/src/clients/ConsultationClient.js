import { AppError } from '@mediassist/common';
import { serviceUnavailableError } from '../errors.js';

// Answers of the Consultation Service that are passed on to the doctor as they are:
// 404 CONSULTATION_NOT_FOUND and 409 SOAP_NOT_READY (design doc 5.5).
const PASSED_ON = new Set([404, 409]);

// Calls the Consultation Service internal API (design doc 5.5). The Prescription Service reads
// consultation data only through here. Kept small, so tests can replace it.
export class ConsultationClient {
  constructor({ baseUrl, timeoutMs = 5000 }) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  // The patient, the notes and the doctor's current medicines. Only for the doctor's own consultation.
  getPrescriptionSource(consultationId, doctorId) {
    return this.#get(`/internal/consultations/${consultationId}/prescription-source?doctorId=${doctorId}`);
  }

  // The patient's name, age, gender, phone and email, read at send time (design doc 4.7.1).
  getPatientContact(consultationId) {
    return this.#get(`/internal/consultations/${consultationId}/patient-contact`);
  }

  async #get(path) {
    let res;
    try {
      res = await fetch(new URL(path, this.baseUrl), { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw serviceUnavailableError();
    }
    const body = await res.json().catch(() => null);
    if (res.ok) return body;
    if (PASSED_ON.has(res.status) && body?.error?.code) {
      throw new AppError(res.status, body.error.code, body.error.message);
    }
    throw serviceUnavailableError();
  }
}
