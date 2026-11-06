import { consultationNotFoundError, patientNotFoundError } from '../errors.js';

const toIso = (date) => date?.toISOString() ?? null;

// Runs the recording logic (design doc Diagram 5). A doctor sees only the consultations of his own
// patients: another doctor's consultation is reported as not found (404), never as forbidden.
export class ConsultationService {
  constructor({ consultationRepository, patientRepository }) {
    this.consultationRepository = consultationRepository;
    this.patientRepository = patientRepository;
  }

  async start(doctorId, clinicalPatientId) {
    if (!(await this.patientRepository.findByDoctorAndId(doctorId, clinicalPatientId))) {
      throw patientNotFoundError();
    }
    const consultation = await this.consultationRepository.create({
      clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });
    return {
      consultationId: consultation.consultationId,
      status: consultation.status,
      startedAt: toIso(consultation.startedAt),
    };
  }

  async getById(doctorId, consultationId) {
    const row = await this.consultationRepository.findByDoctorAndId(doctorId, consultationId);
    if (!row) throw consultationNotFoundError();
    return {
      consultationId: row.consultationId,
      patient: row.clinicalPatient,
      status: row.status,
      failureReason: row.failureReason,
      // A DATE column: send only YYYY-MM-DD.
      followUpDate: row.followUpDate?.toISOString().slice(0, 10) ?? null,
      startedAt: toIso(row.startedAt),
      endedAt: toIso(row.endedAt),
    };
  }

  // For the Prescription Service (GET /internal/consultations/{id}/patient-contact).
  async getPatientContact(consultationId) {
    const row = await this.consultationRepository.findPatientContact(consultationId);
    if (!row) throw consultationNotFoundError();
    return row.clinicalPatient;
  }
}
