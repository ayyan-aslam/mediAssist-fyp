import { pipeline } from 'node:stream/promises';
import { prescriptionNotFoundError } from '../errors.js';
import { clientIp, currentDoctorId, currentDoctorName } from './currentDoctor.js';

// Receives the prescription requests: design doc Section 5.7 and Diagrams 8 and 9.
export class PrescriptionController {
  constructor({ requestValidator, prescriptionService }) {
    this.requestValidator = requestValidator;
    this.prescriptionService = prescriptionService;
  }

  finalize = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const { consultationId } = this.requestValidator.validateFinalize(req.body);
    const prescription = await this.prescriptionService.finalize(doctorId, currentDoctorName(req), consultationId);
    res.status(201).json(prescription);
  };

  getByConsultation = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const { consultationId } = this.requestValidator.validateByConsultation(req.query);
    res.json(await this.prescriptionService.getByConsultation(doctorId, consultationId));
  };

  getById = async (req, res) => {
    const doctorId = currentDoctorId(req);
    res.json(await this.prescriptionService.getById(doctorId, this.#prescriptionId(req)));
  };

  downloadPdf = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const prescriptionId = this.#prescriptionId(req);
    const pdf = await this.prescriptionService.getPdf(doctorId, prescriptionId);
    res
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="prescription-${prescriptionId}.pdf"`)
      .set('Cache-Control', 'no-store');
    await pipeline(pdf, res);
  };

  getSendOptions = async (req, res) => {
    const doctorId = currentDoctorId(req);
    res.json(await this.prescriptionService.getSendOptions(doctorId, this.#prescriptionId(req)));
  };

  send = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const prescriptionId = this.#prescriptionId(req);
    const { channel } = this.requestValidator.validateSend(req.body);
    const result = await this.prescriptionService.send(
      doctorId,
      currentDoctorName(req),
      clientIp(req),
      prescriptionId,
      channel,
    );
    res.status(202).json(result);
  };

  listDeliveries = async (req, res) => {
    const doctorId = currentDoctorId(req);
    const prescriptionId = this.#prescriptionId(req);
    const paging = this.requestValidator.validateList(req.query);
    res.json(await this.prescriptionService.listDeliveries(doctorId, prescriptionId, paging));
  };

  #prescriptionId(req) {
    return this.requestValidator.parseId(req.params.prescriptionId, prescriptionNotFoundError);
  }
}
