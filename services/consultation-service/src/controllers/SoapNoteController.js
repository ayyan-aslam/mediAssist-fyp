import { consultationNotFoundError, patientNotFoundError } from '../errors.js';
import { clientIp, currentDoctorId, currentDoctorName } from './currentDoctor.js';

// SOAP note endpoints: design doc Section 5.5 and Diagram 12.
export class SoapNoteController {
  constructor({ requestValidator, soapNoteEditService, soapNoteHistoryService, soapNotePdfService }) {
    this.requestValidator = requestValidator;
    this.soapNoteEditService = soapNoteEditService;
    this.soapNoteHistoryService = soapNoteHistoryService;
    this.soapNotePdfService = soapNotePdfService;
  }

  // Opening the note starts the editing session.
  getSoapNote = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    res.json(await this.soapNoteEditService.open(consultationId, doctorId, clientIp(req)));
  };

  // Auto-save: only the parts that changed. No audit event here.
  updateSoapNote = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    const changes = this.requestValidator.validateSoapNoteChanges(req.body);
    res.json(await this.soapNoteEditService.autoSave(consultationId, doctorId, clientIp(req), changes));
  };

  finishEditing = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    res.json(await this.soapNoteEditService.finishEditing(consultationId, doctorId));
  };

  // Made on download, never stored.
  downloadPdf = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    const pdf = await this.soapNotePdfService.createPdf(consultationId, doctorId, currentDoctorName(req));
    res
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="soap-note-${consultationId}.pdf"`)
      .set('Cache-Control', 'no-store')
      .send(pdf);
  };

  listForPatient = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const patientId = this.requestValidator.parseId(req.params.patientId, patientNotFoundError);
    const paging = this.requestValidator.validateList(req.query);
    res.json(await this.soapNoteHistoryService.listForPatient(doctorId, patientId, paging));
  };

  // The doctor's latest SOAP notes, newest first (the "Recent notes" card).
  listRecent = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const paging = this.requestValidator.validateList(req.query);
    res.json(await this.soapNoteHistoryService.search(doctorId, paging));
  };

  search = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const query = this.requestValidator.validateSearch(req.query);
    res.json(await this.soapNoteHistoryService.search(doctorId, query));
  };
}
