import { patientNotFoundError } from '../errors.js';

// A TIMESTAMP as a date: YYYY-MM-DD (design doc 5.1.1).
const toDate = (date) => date.toISOString().slice(0, 10);

// A patient's previous SOAP notes and the SOAP note search (design doc 5.5, FR-11 and FR-12).
// The doctor's latest notes (GET /soap-notes) use the search without q.
// All are paged lists (5.1.2) and cover only the doctor's own patients.
export class SoapNoteHistoryService {
  constructor({ soapNoteRepository, patientRepository }) {
    this.soapNoteRepository = soapNoteRepository;
    this.patientRepository = patientRepository;
  }

  // Every consultation of the patient, newest first. assessment is null while the note is not ready.
  async listForPatient(doctorId, clinicalPatientId, { page, pageSize }) {
    if (!(await this.patientRepository.findByDoctorAndId(doctorId, clinicalPatientId))) throw patientNotFoundError();
    const { rows, total } = await this.soapNoteRepository.findByPatient(doctorId, clinicalPatientId, { page, pageSize });
    const items = rows.map((row) => ({
      consultationId: row.consultationId,
      date: toDate(row.startedAt),
      status: row.status,
      assessment: row.soapNote?.assessment ?? null,
    }));
    return { items, page, pageSize, total };
  }

  // q is undefined for GET /soap-notes: the doctor's latest notes.
  async search(doctorId, { q, page, pageSize }) {
    const { rows, total } = await this.soapNoteRepository.search(doctorId, q, { page, pageSize });
    const items = rows.map((row) => ({
      consultationId: row.consultationId,
      date: toDate(row.startedAt),
      patient: { clinicalPatientId: row.clinicalPatientId, fullName: row.fullName, phone: row.phone },
    }));
    return { items, page, pageSize, total };
  }
}
