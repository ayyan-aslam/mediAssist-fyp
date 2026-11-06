import { patientNotFoundError } from '../errors.js';
import { currentDoctorId } from './currentDoctor.js';

// Clinic patient endpoints: design doc Section 5.5.
export class PatientController {
  constructor({ requestValidator, patientService }) {
    this.requestValidator = requestValidator;
    this.patientService = patientService;
  }

  create = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const data = this.requestValidator.validateCreatePatient(req.body);
    res.status(201).json(await this.patientService.create(doctorId, data));
  };

  findByPhone = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const { phone } = this.requestValidator.validateFindPatient(req.query);
    res.json(await this.patientService.findByPhone(doctorId, phone));
  };

  getById = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const patientId = this.requestValidator.parseId(req.params.patientId, patientNotFoundError);
    res.json(await this.patientService.getById(doctorId, patientId));
  };

  update = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const patientId = this.requestValidator.parseId(req.params.patientId, patientNotFoundError);
    const changes = this.requestValidator.validateUpdatePatient(req.body);
    res.json(await this.patientService.update(doctorId, patientId, changes));
  };
}
