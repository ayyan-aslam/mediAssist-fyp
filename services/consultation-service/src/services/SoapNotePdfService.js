import { consultationNotFoundError, soapNotReadyError } from '../errors.js';

// The SOAP note PDF (design doc 5.5): made when the doctor downloads it, never stored.
export class SoapNotePdfService {
  constructor({ soapNoteRepository, pdfGenerator }) {
    this.soapNoteRepository = soapNoteRepository;
    this.pdfGenerator = pdfGenerator;
  }

  async createPdf(consultationId, doctorId, doctorName) {
    const row = await this.soapNoteRepository.findForPdf(consultationId, doctorId);
    if (!row) throw consultationNotFoundError();
    if (!row.soapNote) throw soapNotReadyError();
    return this.pdfGenerator.createSoapNotePdf({
      doctorName,
      patient: row.clinicalPatient,
      date: row.startedAt,
      note: row.soapNote,
    });
  }
}
