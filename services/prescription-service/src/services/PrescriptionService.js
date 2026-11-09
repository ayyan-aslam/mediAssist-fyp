import { randomUUID } from 'node:crypto';
import {
  channelNotAvailableError,
  noEmailError,
  prescriptionEmptyError,
  prescriptionExistsError,
  prescriptionNotFoundError,
  serviceUnavailableError,
} from '../errors.js';

const isUniqueViolation = (err) => err?.code === 'P2002';

// AI text can be longer than a column (design doc 4.4.5), so it is cut to fit.
const clip = (value, max) => (value ? String(value).slice(0, max) : null);

// "ali@example.com" -> "al***@example.com" (design doc 5.7).
export function maskEmail(email) {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  return `${local.slice(0, local.length > 2 ? 2 : 1)}***${email.slice(at)}`;
}

// The prescription object (design doc 5.7).
const toPrescription = (row) => ({
  prescriptionId: row.prescriptionId,
  consultationId: row.consultationId,
  status: row.status,
  patientName: row.patientName,
  notes: row.notes,
  createdAt: row.createdAt.toISOString(),
  items: row.items.map((item) => ({
    itemId: item.itemId,
    position: item.position,
    medicineName: item.medicineName,
    genericName: item.genericName,
    dose: item.dose,
    frequency: item.frequency,
    duration: item.duration,
    instructions: item.instructions,
    source: item.source,
    referenceInfo: item.referenceInfo ?? null,
  })),
});

const toDelivery = (row) => ({
  sendId: row.sendId,
  channel: row.channel,
  recipient: maskEmail(row.recipient),
  status: row.status,
  errorMessage: row.errorMessage,
  requestedAt: row.requestedAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
});

// Finalizes, sends and reads prescriptions (design doc 3.4.6, Diagrams 8 and 9).
export class PrescriptionService {
  constructor({ prescriptionRepository, consultationClient, prescriptionPdf, s3Client, eventPublisher, logger }) {
    this.prescriptionRepository = prescriptionRepository;
    this.consultationClient = consultationClient;
    this.prescriptionPdf = prescriptionPdf;
    this.s3Client = s3Client;
    this.eventPublisher = eventPublisher;
    this.logger = logger;
  }

  // Saves a final copy of the doctor's current prescription, makes the PDF and saves it in S3.
  async finalize(doctorId, doctorName, consultationId) {
    const existing = await this.prescriptionRepository.findByConsultation(consultationId, doctorId);
    if (existing) throw prescriptionExistsError(existing.prescriptionId);

    // 404 CONSULTATION_NOT_FOUND (also for another doctor's consultation) and 409 SOAP_NOT_READY come from here.
    const source = await this.consultationClient.getPrescriptionSource(consultationId, doctorId);
    if (source.medicines.length === 0) throw prescriptionEmptyError();

    let prescription;
    try {
      prescription = await this.prescriptionRepository.create({
        consultationId,
        doctorId,
        patientName: clip(source.patient.name, 150),
        notes: source.notes || null,
        items: source.medicines.map((medicine, i) => ({
          position: i + 1,
          medicineName: clip(medicine.name, 200),
          genericName: clip(medicine.genericName, 200),
          dose: clip(medicine.dose, 100),
          frequency: clip(medicine.frequency, 100),
          duration: clip(medicine.duration, 100),
          instructions: clip(medicine.instructions, 500),
          source: medicine.source,
          referenceInfo: medicine.referenceInfo ?? null,
        })),
      });
    } catch (err) {
      // The same doctor pressed finalize twice at once: the other request saved it first.
      if (!isUniqueViolation(err)) throw err;
      const saved = await this.prescriptionRepository.findByConsultation(consultationId, doctorId);
      throw prescriptionExistsError(saved?.prescriptionId ?? null);
    }

    try {
      const pdf = await this.prescriptionPdf.build({
        doctorName,
        patient: source.patient,
        date: prescription.createdAt,
        items: prescription.items,
        notes: prescription.notes,
      });
      await this.s3Client.upload(prescription.pdfKey, pdf, 'application/pdf');
    } catch (err) {
      // Without its PDF the prescription cannot be downloaded or sent. Remove it, so the doctor can try again.
      this.logger.error({ err, consultationId }, 'Could not save the prescription PDF');
      await this.prescriptionRepository.delete(prescription.prescriptionId);
      throw serviceUnavailableError();
    }

    this.logger.info({ consultationId, prescriptionId: prescription.prescriptionId }, 'Prescription finalized');
    return toPrescription(prescription);
  }

  async getByConsultation(doctorId, consultationId) {
    const row = await this.prescriptionRepository.findByConsultation(consultationId, doctorId);
    if (!row) throw prescriptionNotFoundError();
    return toPrescription(row);
  }

  async getById(doctorId, prescriptionId) {
    return toPrescription(await this.#find(doctorId, prescriptionId));
  }

  // The PDF as a stream from S3.
  async getPdf(doctorId, prescriptionId) {
    const row = await this.#find(doctorId, prescriptionId);
    try {
      return await this.s3Client.getStream(row.pdfKey);
    } catch (err) {
      this.logger.error({ err, prescriptionId }, 'Could not read the prescription PDF');
      throw serviceUnavailableError();
    }
  }

  async getSendOptions(doctorId, prescriptionId) {
    const row = await this.#find(doctorId, prescriptionId);
    const contact = await this.consultationClient.getPatientContact(row.consultationId);
    return {
      email: contact.email
        ? { available: true, recipient: maskEmail(contact.email) }
        : { available: false, recipient: null },
      whatsapp: { available: false, reason: 'Coming later' },
    };
  }

  // Records the request and asks the Notification Service to email the PDF. The result comes later
  // (delivery.result). The email address is read now, so a changed address is used (design doc 4.7.1).
  async send(doctorId, doctorName, ipAddress, prescriptionId, channel) {
    const row = await this.#find(doctorId, prescriptionId);
    if (channel !== 'email') throw channelNotAvailableError();
    const contact = await this.consultationClient.getPatientContact(row.consultationId);
    if (!contact.email) throw noEmailError();

    const messageId = randomUUID();
    const send = await this.prescriptionRepository.createSend({
      prescriptionId,
      messageId,
      channel,
      recipient: contact.email,
      requestedAt: new Date(),
    });

    try {
      await this.eventPublisher.publish(
        'prescription.send',
        {
          prescriptionId,
          consultationId: row.consultationId,
          doctorId,
          channel,
          recipient: contact.email,
          patientName: row.patientName,
          doctorName,
          pdfKey: row.pdfKey,
        },
        { messageId },
      );
    } catch (err) {
      this.logger.error({ err, prescriptionId }, 'Could not send prescription.send');
      await this.prescriptionRepository.completeSend({
        prescriptionId,
        messageId,
        status: 'failed',
        errorMessage: 'The email could not be started. Please try again.',
        completedAt: new Date(),
      });
      throw serviceUnavailableError();
    }

    try {
      await this.eventPublisher.publish('audit.event', {
        userId: doctorId,
        action: 'prescription_send',
        details: `Prescription ${prescriptionId} sent by email`,
        ipAddress,
        occurredAt: send.requestedAt.toISOString(),
      });
    } catch (err) {
      // The email is on its way. A missing audit entry must not fail the send.
      this.logger.error({ err, prescriptionId }, 'Could not send the prescription_send audit event');
    }

    return { sendId: send.sendId, status: 'sending' };
  }

  async listDeliveries(doctorId, prescriptionId, paging) {
    await this.#find(doctorId, prescriptionId);
    const { rows, total } = await this.prescriptionRepository.listSends(prescriptionId, paging);
    return { items: rows.map(toDelivery), ...paging, total };
  }

  // delivery.result (design doc 6.4.8): sent or failed. Safe to run twice: only a send that is still
  // sending changes. A result for an unknown request is skipped.
  async saveDeliveryResult(data) {
    const changed = await this.prescriptionRepository.completeSend({
      prescriptionId: data.prescriptionId,
      messageId: data.requestMessageId,
      status: data.status,
      errorMessage: data.status === 'failed' ? (clip(data.errorMessage, 255) ?? 'The email could not be sent.') : null,
      completedAt: new Date(),
    });
    if (!changed) {
      this.logger.info({ requestMessageId: data.requestMessageId }, 'Delivery result already saved or unknown. Skipped.');
    }
  }

  async #find(doctorId, prescriptionId) {
    const row = await this.prescriptionRepository.findById(prescriptionId, doctorId);
    if (!row) throw prescriptionNotFoundError();
    return row;
  }
}
