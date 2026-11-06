import { consultationNotFoundError, patientNotFoundError } from '../errors.js';
import { clientIp, currentDoctorId } from './currentDoctor.js';

// SOAP note endpoints: design doc Section 5.5 and Diagram 12.
export class SoapNoteController {
  constructor({ requestValidator, soapNoteEditService, soapNoteHistoryService }) {
    this.requestValidator = requestValidator;
    this.soapNoteEditService = soapNoteEditService;
    this.soapNoteHistoryService = soapNoteHistoryService;
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

  listForPatient = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const patientId = this.requestValidator.parseId(req.params.patientId, patientNotFoundError);
    const paging = this.requestValidator.validateList(req.query);
    res.json(await this.soapNoteHistoryService.listForPatient(doctorId, patientId, paging));
  };

  search = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const query = this.requestValidator.validateSearch(req.query);
    res.json(await this.soapNoteHistoryService.search(doctorId, query));
  };
}
