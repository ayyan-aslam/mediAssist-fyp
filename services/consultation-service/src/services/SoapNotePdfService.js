import { consultationNotFoundError, soapNotReadyError } from '../errors.js';
import { toAiInsights } from './aiInsights.js';

// The SOAP note PDF (design doc 5.5): made when the doctor downloads it, never stored. Next to the four
// parts it has the symptoms, the medication history and the prescription, with the doctor's edits.
// The AI suggestions for review are left out: the doctor did not prescribe them.
export class SoapNotePdfService {
  constructor({ soapNoteRepository, pdfGenerator }) {
    this.soapNoteRepository = soapNoteRepository;
    this.pdfGenerator = pdfGenerator;
  }

  async createPdf(consultationId, doctorId, doctorName) {
    const row = await this.soapNoteRepository.findForPdf(consultationId, doctorId);
    if (!row) throw consultationNotFoundError();
    if (!row.soapNote) throw soapNotReadyError();
    const { aiResult, prescription, symptoms, ...note } = row.soapNote;
    const insights = toAiInsights(aiResult, { prescription, symptoms });
    return this.pdfGenerator.createSoapNotePdf({
      doctorName,
      patient: row.clinicalPatient,
      date: row.startedAt,
      note,
      symptoms: insights?.symptoms ?? [],
      medicationHistory: insights?.medicationHistory ?? [],
      prescription: insights?.prescription ?? [],
    });
  }
}
