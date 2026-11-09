import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { isPermanentEmailError, isRejectedAddressError } from '../clients/EmailSender.js';
import { prescriptionEmail } from './emails.js';

export const MAX_EMAIL_TRIES = 3;

const INVALID_ADDRESS = "The patient's email address is not valid.";
const REJECTED_ADDRESS = "The patient's email address was rejected by the mail server.";
const NOT_SENT = 'The email could not be sent. Please try again later.';
const PDF_NOT_READ = 'The prescription PDF could not be read. Please try again.';

const isEmail = (value) => z.email().safeParse(value).success;

// Sends the prescription PDF by email, tries up to 3 times, saves the result in PRESCRIPTION_DELIVERY and
// sends delivery.result (design doc Diagram 9, 6.4.7 and 6.4.8).
export class DeliveryService {
  // retryDelayMs: the short wait between two tries.
  constructor({ deliveryRepository, s3Client, emailSender, eventPublisher, logger, retryDelayMs = 2000 }) {
    this.deliveryRepository = deliveryRepository;
    this.s3Client = s3Client;
    this.emailSender = emailSender;
    this.eventPublisher = eventPublisher;
    this.logger = logger;
    this.retryDelayMs = retryDelayMs;
  }

  // messageId: of the prescription.send message. data: its checked data.
  // Safe to run twice: a request that is already saved is not sent again. Its result is sent again, in case
  // the first run stopped before delivery.result went out (a second update does no harm, 6.4.8).
  async handlePrescriptionSend(messageId, data) {
    const saved = await this.deliveryRepository.findByMessageId(messageId);
    if (saved) {
      this.logger.info({ messageId, prescriptionId: data.prescriptionId }, 'Prescription already handled, not sent again');
      await this.#publishResult(messageId, data, saved);
      return;
    }

    // If S3 does not answer, the error sends the message to the retry queue (10 s, 3 times in all).
    const pdf = await this.s3Client.getBuffer(data.pdfKey);
    const result = await this.#sendWithTries(messageId, data, pdf);
    await this.#save(messageId, data, result);
  }

  // The message moved to the dead-letter queue (for example the PDF could not be read 3 times). Saves a
  // failed result, so the doctor sees it and can send again.
  async handleDeadLetter(messageId, data) {
    if (await this.deliveryRepository.findByMessageId(messageId)) return;
    await this.#save(messageId, data, { status: 'failed', errorMessage: PDF_NOT_READ, attemptedAt: new Date() });
  }

  async #sendWithTries(messageId, data, pdf) {
    const log = { messageId, prescriptionId: data.prescriptionId };
    if (!isEmail(data.recipient)) {
      this.logger.warn(log, 'Prescription not sent: the email address is not valid');
      return { status: 'failed', errorMessage: INVALID_ADDRESS, attemptedAt: new Date() };
    }

    const { subject, text, html } = prescriptionEmail(data);
    const attachments = [
      { filename: `prescription-${data.prescriptionId}.pdf`, content: pdf, contentType: 'application/pdf' },
    ];

    for (let tryNo = 1; ; tryNo++) {
      const attemptedAt = new Date();
      try {
        await this.emailSender.send({ to: data.recipient, subject, text, html, attachments });
        this.logger.info({ ...log, tryNo }, 'Prescription sent by email');
        return { status: 'sent', errorMessage: null, attemptedAt };
      } catch (err) {
        const permanent = isPermanentEmailError(err);
        this.logger.warn({ ...log, err, tryNo, permanent }, 'Prescription email failed');
        if (permanent || tryNo === MAX_EMAIL_TRIES) {
          return { status: 'failed', errorMessage: isRejectedAddressError(err) ? REJECTED_ADDRESS : NOT_SENT, attemptedAt };
        }
        await sleep(this.retryDelayMs);
      }
    }
  }

  async #save(messageId, data, { status, errorMessage, attemptedAt }) {
    let delivery;
    try {
      delivery = await this.deliveryRepository.create({
        messageId,
        prescriptionId: data.prescriptionId,
        channel: data.channel,
        recipient: data.recipient,
        status,
        errorMessage,
        attemptedAt,
      });
    } catch (err) {
      // Another run saved this request first. Its result is the one that counts.
      if (err.code !== 'P2002') throw err;
      delivery = await this.deliveryRepository.findByMessageId(messageId);
    }
    await this.#publishResult(messageId, data, delivery);
  }

  async #publishResult(messageId, data, delivery) {
    await this.eventPublisher.publish('delivery.result', {
      prescriptionId: delivery.prescriptionId,
      doctorId: data.doctorId,
      requestMessageId: messageId,
      channel: delivery.channel,
      status: delivery.status,
      errorMessage: delivery.errorMessage,
      attemptedAt: delivery.attemptedAt.toISOString(),
    });
  }
}
