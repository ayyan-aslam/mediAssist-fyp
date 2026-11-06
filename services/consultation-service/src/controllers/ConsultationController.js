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

  // Internal (Prescription Service). The gateway does not expose /internal routes, so there is no user.
  getPatientContact = async (req, res) => {
    const consultationId = this.requestValidator.parseId(req.params.consultationId, consultationNotFoundError);
    res.json(await this.consultationService.getPatientContact(consultationId));
  };
}
