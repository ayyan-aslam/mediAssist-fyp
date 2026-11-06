// The consultation_failed message for each failure reason (design doc 5.5).
export const FAILURE_MESSAGES = {
  TRANSCRIPTION_FAILED: 'Some audio could not be processed. Please try again.',
  AI_FAILED: 'The SOAP note could not be written. Please try again.',
  AI_TIMEOUT: 'The SOAP note is taking too long. Please try again.',
};

// soap.generated sends an empty string when a part has nothing, but null is saved as an empty string too.
const text = (value) => value ?? '';

// Sends the full transcript to the AI Pipeline and saves its answer (design doc Diagram 6, Parts 2 and 3).
// Every handler is safe to run twice, and AI answers are saved only for the current soap_attempt.
export class SoapNoteService {
  constructor({
    soapNoteRepository,
    transcriptRepository,
    transcriptionService,
    eventPublisher,
    aiAnswerTimeoutSec,
    logger,
  }) {
    this.soapNoteRepository = soapNoteRepository;
    this.transcriptRepository = transcriptRepository;
    this.transcriptionService = transcriptionService;
    this.eventPublisher = eventPublisher;
    this.aiAnswerTimeoutSec = aiAnswerTimeoutSec;
    this.logger = logger;
  }

  // consultation.recorded (6.4.2): transcribes the minutes that are not done, then sends transcript.ready.
  async finishTranscript(consultationId, totalParts) {
    const consultation = await this.soapNoteRepository.findConsultation(consultationId);
    if (!consultation || consultation.hasNote || consultation.status !== 'processing') {
      this.logger.info({ consultationId, status: consultation?.status }, 'Nothing to finish. Skipping it.');
      return;
    }

    const { failedWindowNos } = await this.transcriptionService.transcribeMissing(consultationId, totalParts);
    if (failedWindowNos.length > 0) {
      this.logger.error({ consultationId, failedWindowNos }, 'Some minutes could not be transcribed');
      await this.#fail(consultationId, 'TRANSCRIPTION_FAILED');
      return;
    }

    const windows = await this.transcriptRepository.findWindows(consultationId);
    const transcript = windows
      .map((window) => window.transcriptText?.trim())
      .filter(Boolean)
      .join('\n');
    const attempt = consultation.soapAttempt;
    const durationSec = await this.soapNoteRepository.getDurationSec(consultationId, totalParts);

    if (!(await this.soapNoteRepository.setAiRequestedAt(consultationId, attempt, new Date()))) {
      this.logger.info({ consultationId, attempt }, 'The consultation moved on while transcribing. Skipping it.');
      return;
    }
    // If this fails, the message is tried again. If it never goes out, the AI answer check fails the
    // consultation after AI_ANSWER_TIMEOUT_SEC, and the doctor can try again.
    await this.eventPublisher.publish('transcript.ready', {
      consultationId,
      attempt,
      patientAge: consultation.patientAge,
      patientGender: consultation.patientGender,
      durationSec,
      transcript,
    });
    this.logger.info({ consultationId, attempt, windows: windows.length }, 'Sent the transcript to the AI Pipeline');
  }

  // soap.generated (6.4.4): saved only for the current attempt, when no note exists and it is processing.
  // aiResult is saved as it is; this service never reads inside it.
  async saveGenerated({ consultationId, attempt, subjective, objective, assessment, plan, aiResult }) {
    const consultation = await this.soapNoteRepository.findConsultation(consultationId);
    if (
      !consultation ||
      consultation.hasNote ||
      consultation.status !== 'processing' ||
      consultation.soapAttempt !== attempt
    ) {
      this.logger.info({ consultationId, attempt }, 'Ignoring an old or repeated SOAP note');
      return;
    }

    const note = await this.soapNoteRepository.saveSoapNote(consultationId, attempt, {
      subjective: text(subjective),
      objective: text(objective),
      assessment: text(assessment),
      plan: text(plan),
      aiResult,
    });
    if (!note) {
      this.logger.info({ consultationId, attempt }, 'Ignoring an old or repeated SOAP note');
      return;
    }
    this.logger.info({ consultationId, attempt, soapNoteId: note.soapNoteId }, 'Saved the SOAP note');

    try {
      await this.eventPublisher.publish('soap.ready', {
        consultationId,
        soapNoteId: note.soapNoteId,
        doctorId: consultation.doctorId,
        clinicalPatientId: consultation.clinicalPatientId,
        patientAge: consultation.patientAge,
        plan: note.plan,
      });
    } catch (err) {
      // The note is saved and the doctor can use it. A repeated soap.generated would be ignored, so
      // throwing here would not send it again either.
      this.logger.error({ err, consultationId }, 'Could not send soap.ready');
    }
    this.notifyDoctor(consultation.doctorId, 'soap_ready', { consultationId });
  }

  // soap.generation.failed (6.4.5): only for the current attempt.
  async markAiFailed({ consultationId, attempt, reason, message }) {
    this.logger.warn({ consultationId, attempt, reason, message }, 'The AI Pipeline could not write the SOAP note');
    await this.#fail(consultationId, 'AI_FAILED', attempt);
  }

  // AI answer check (design doc 3.8), every 15 seconds.
  async failTimedOut() {
    const requestedBefore = new Date(Date.now() - this.aiAnswerTimeoutSec * 1000);
    const rows = await this.soapNoteRepository.markTimedOut(requestedBefore);
    for (const { consultationId, doctorId } of rows) {
      this.logger.warn({ consultationId }, 'The AI Pipeline did not answer in time');
      this.#notifyFailed(doctorId, consultationId, 'AI_TIMEOUT');
    }
  }

  // Tells the doctor's app. For now it only logs; the SSE connection is added later.
  notifyDoctor(doctorId, event, data) {
    this.logger.info({ doctorId, event, data }, 'Doctor notification');
  }

  async #fail(consultationId, failureReason, attempt) {
    const row = await this.soapNoteRepository.markFailed(consultationId, failureReason, attempt);
    if (!row) {
      this.logger.info({ consultationId, attempt }, 'Already completed, failed or an old attempt. Skipping it.');
      return;
    }
    this.#notifyFailed(row.doctorId, consultationId, failureReason);
  }

  #notifyFailed(doctorId, consultationId, failureReason) {
    this.notifyDoctor(doctorId, 'consultation_failed', {
      consultationId,
      failureReason,
      message: FAILURE_MESSAGES[failureReason],
    });
  }
}
