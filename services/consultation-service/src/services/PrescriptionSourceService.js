import { consultationNotFoundError, soapNotReadyError } from '../errors.js';
import { toAiInsights } from './aiInsights.js';

// Where a medicine came from (PRESCRIPTION_ITEM.source, design doc 4.4.5).
function sourceOf(medicine) {
  if (medicine.aiIndex !== null) return 'doctor_prescribed';
  if (medicine.reviewIndex !== null) return 'ai_accepted';
  return 'doctor_added';
}

// Everything the Prescription Service needs to finalize a prescription (design doc 5.5,
// GET /internal/consultations/{id}/prescription-source). The medicines are the doctor's edited
// prescription when it exists, otherwise the AI's prescribed medicines.
export class PrescriptionSourceService {
  constructor({ soapNoteRepository }) {
    this.soapNoteRepository = soapNoteRepository;
  }

  async getPrescriptionSource(consultationId, doctorId) {
    const row = await this.soapNoteRepository.findPrescriptionSource(consultationId, doctorId);
    if (!row) throw consultationNotFoundError();
    if (!row.soapNote) throw soapNotReadyError();
    const { clinicalPatient: patient, soapNote: note } = row;
    const insights = toAiInsights(note.aiResult, { prescription: note.prescription });
    return {
      consultationId,
      doctorId,
      patient: {
        name: patient.fullName,
        age: patient.age,
        gender: patient.gender,
        phone: patient.phone,
        email: patient.email,
      },
      notes: note.plan,
      // An AI medicine without a name cannot be printed, so it is left out.
      medicines: (insights?.prescription ?? [])
        .filter((medicine) => medicine.name)
        .map((medicine) => ({
          name: medicine.name,
          genericName: medicine.genericName,
          dose: medicine.dose,
          frequency: medicine.frequency,
          duration: medicine.duration,
          instructions: medicine.instructions,
          source: sourceOf(medicine),
          referenceInfo: medicine.info,
        })),
    };
  }
}
