import {
  consultationNotFoundError,
  notFailedError,
  notRecordingError,
  partsMissingError,
  patientNotFoundError,
  recordingTooLongError,
} from '../errors.js';

const toIso = (date) => date?.toISOString() ?? null;
const isUniqueViolation = (err) => err?.code === 'P2002';

// 10-second parts, 6 per minute, 30 minutes at most (design doc 3.4.4).
export const PARTS_PER_WINDOW = 6;
export const MAX_PARTS = 180;

export const audioPartKey = (consultationId, partNo) => `consultations/${consultationId}/parts/${partNo}.webm`;

// Runs the recording logic (design doc Diagram 5). A doctor sees only the consultations of his own
// patients: another doctor's consultation is reported as not found (404), never as forbidden.
export class ConsultationService {
  constructor({ consultationRepository, patientRepository, transcriptRepository, s3Client, eventPublisher, logger }) {
    this.consultationRepository = consultationRepository;
    this.patientRepository = patientRepository;
    this.transcriptRepository = transcriptRepository;
    this.s3Client = s3Client;
    this.eventPublisher = eventPublisher;
    this.logger = logger;
  }

  async start(doctorId, clinicalPatientId) {
    if (!(await this.patientRepository.findByDoctorAndId(doctorId, clinicalPatientId))) {
      throw patientNotFoundError();
    }
    const consultation = await this.consultationRepository.create({
      clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });
    return {
      consultationId: consultation.consultationId,
      status: consultation.status,
      startedAt: toIso(consultation.startedAt),
    };
  }

  async getById(doctorId, consultationId) {
    const row = await this.consultationRepository.findByDoctorAndId(doctorId, consultationId);
    if (!row) throw consultationNotFoundError();
    return {
      consultationId: row.consultationId,
      patient: row.clinicalPatient,
      status: row.status,
      failureReason: row.failureReason,
      // A DATE column: send only YYYY-MM-DD.
      followUpDate: row.followUpDate?.toISOString().slice(0, 10) ?? null,
      startedAt: toIso(row.startedAt),
      endedAt: toIso(row.endedAt),
    };
  }

  // Saves one 10-second part (Diagram 5, Part 3). Returns { created } so the controller can answer
  // 201 for a new part and 200 for a part that was already saved (sent again after the internet dropped).
  async savePart(doctorId, consultationId, { partNo, durationSec, audio, contentType }) {
    const consultation = await this.consultationRepository.findByDoctorAndId(doctorId, consultationId);
    if (!consultation) throw consultationNotFoundError();
    if (await this.consultationRepository.findPart(consultationId, partNo)) return { created: false };
    if (consultation.status !== 'recording') throw notRecordingError();
    if (partNo > MAX_PARTS) throw recordingTooLongError();

    const fileKey = await this.s3Client.upload(audioPartKey(consultationId, partNo), audio, contentType);
    try {
      await this.consultationRepository.savePart({ consultationId, partNo, fileKey, durationSec });
    } catch (err) {
      // The same part arrived twice at the same time and the other request saved it first.
      if (isUniqueViolation(err)) return { created: false };
      throw err;
    }

    await this.#sendWindowIfFull(consultationId, Math.ceil(partNo / PARTS_PER_WINDOW));
    return { created: true };
  }

  // When all 6 parts of the minute are saved, creates its TRANSCRIPT_WINDOW row and sends
  // audio.window.ready (6.4.1). Only the request whose INSERT created the row sends the message,
  // so each minute is sent once, even when its parts arrive together or out of order.
  async #sendWindowIfFull(consultationId, windowNo) {
    const lastPartNo = windowNo * PARTS_PER_WINDOW;
    const firstPartNo = lastPartNo - PARTS_PER_WINDOW + 1;
    const saved = await this.consultationRepository.countPartsInRange(consultationId, firstPartNo, lastPartNo);
    if (saved < PARTS_PER_WINDOW) return;
    if (!(await this.transcriptRepository.createPendingWindow(consultationId, windowNo))) return;

    try {
      await this.eventPublisher.publish('audio.window.ready', { consultationId, windowNo, firstPartNo, lastPartNo });
    } catch (err) {
      // The part is saved, so the upload still succeeds. Without its row the minute counts as
      // missing, and it is transcribed when the recording stops (design doc 3.4.4).
      this.logger.error({ err, consultationId, windowNo }, 'Could not send audio.window.ready');
      await this.transcriptRepository.deleteWindow(consultationId, windowNo);
    }
  }

  // Stops the recording (Diagram 5, Part 4): checks that parts 1 to totalParts are all saved, sets the status
  // to processing and sends consultation.recorded (6.4.2), which finishes the transcript.
  async stop(doctorId, consultationId, totalParts) {
    const consultation = await this.consultationRepository.findByDoctorAndId(doctorId, consultationId);
    if (!consultation) throw consultationNotFoundError();
    if (consultation.status !== 'recording') throw notRecordingError();

    const saved = new Set(await this.consultationRepository.findSavedPartNos(consultationId));
    const missingParts = [];
    for (let partNo = 1; partNo <= totalParts; partNo += 1) {
      if (!saved.has(partNo)) missingParts.push(partNo);
    }
    if (missingParts.length > 0) throw partsMissingError(missingParts);

    const endedAt = new Date();
    if (!(await this.consultationRepository.markProcessing(consultationId, endedAt))) throw notRecordingError();
    try {
      await this.#sendRecorded(consultationId, totalParts, endedAt);
    } catch (err) {
      // Without the message nothing would finish the transcript. Undo, so the app can call stop again.
      await this.consultationRepository.backToRecording(consultationId);
      throw err;
    }
    return { consultationId, status: 'processing', endedAt: toIso(endedAt) };
  }

  // Try again after a failure: the next attempt, then consultation.recorded again. Nothing is recorded again;
  // only the minutes that are not done are transcribed, and the transcript is sent with the new attempt.
  async retry(doctorId, consultationId) {
    const consultation = await this.consultationRepository.findByDoctorAndId(doctorId, consultationId);
    if (!consultation) throw consultationNotFoundError();
    if (!(await this.consultationRepository.startRetry(consultationId))) throw notFailedError();

    try {
      const totalParts = await this.consultationRepository.countParts(consultationId);
      await this.#sendRecorded(consultationId, totalParts, consultation.endedAt);
    } catch (err) {
      await this.consultationRepository.backToFailed(consultationId, consultation.failureReason);
      throw err;
    }
    return { consultationId, status: 'processing' };
  }

  #sendRecorded(consultationId, totalParts, endedAt) {
    return this.eventPublisher.publish('consultation.recorded', {
      consultationId,
      totalParts,
      lastFullWindowNo: Math.floor(totalParts / PARTS_PER_WINDOW),
      endedAt: toIso(endedAt),
    });
  }

  // For the Prescription Service (GET /internal/consultations/{id}/patient-contact).
  async getPatientContact(consultationId) {
    const row = await this.consultationRepository.findPatientContact(consultationId);
    if (!row) throw consultationNotFoundError();
    return row.clinicalPatient;
  }
}
