import { consultationNotFoundError } from '../errors.js';
import { currentDoctorId } from './currentDoctor.js';

// Consultation endpoints: design doc Section 5.5.
export class ConsultationController {
  constructor({ requestValidator, consultationService }) {
    this.requestValidator = requestValidator;
    this.consultationService = consultationService;
  }

  start = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const { clinicalPatientId } = this.requestValidator.validateStartConsultation(req.body);
    res.status(201).json(await this.consultationService.start(doctorId, clinicalPatientId));
  };

  getById = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    res.json(await this.consultationService.getById(doctorId, consultationId));
  };

  // 201 for a new part, 200 when the part was already saved. The body is the same.
  uploadPart = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    const { partNo, durationSec } = this.requestValidator.validateAudioPart(req.body, req.file);
    const { created } = await this.consultationService.savePart(doctorId, consultationId, {
      partNo,
      durationSec,
      audio: req.file.buffer,
      contentType: req.file.mimetype,
    });
    res.status(created ? 201 : 200).json({ partNo, saved: true });
  };

  // Internal (Prescription Service). The gateway does not expose /internal routes, so there is no user.
  getPatientContact = async (req, res) => {
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    res.json(await this.consultationService.getPatientContact(consultationId));
  };
}
