import { createLogger } from '@mediassist/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAILURE_MESSAGES, SoapNoteService } from '../src/services/SoapNoteService.js';

const CONSULTATION_ID = 41;
const DOCTOR_ID = 16;

const AI_RESULT = {
  schema_version: '1.0',
  soap: {
    subjective: 'Sore throat for 3 days.',
    objective: null,
    assessment: 'Likely viral throat infection.',
    plan: { notes: 'Warm salt water gargles.', prescription: [], for_doctor_review: [] },
    medication_history: [],
  },
  symptoms: [{ symptom: 'sore throat', mention: 'gala kharab' }],
  warnings: [],
};

// CONSULTATION and SOAP_NOTE in memory, with the same status and attempt rules as SoapNoteRepository.
// The TranscriptionService and the EventPublisher are mocked.
function createContext() {
  const consultation = { status: 'processing', soapAttempt: 1, aiRequestedAt: null, failureReason: null };
  const notes = [];
  const processing = (attempt) =>
    consultation.status === 'processing' && (attempt === undefined || consultation.soapAttempt === attempt);

  const soapNoteRepository = {
    findConsultation: vi.fn(async () => ({
      consultationId: CONSULTATION_ID,
      status: consultation.status,
      soapAttempt: consultation.soapAttempt,
      hasNote: notes.length > 0,
      doctorId: DOCTOR_ID,
      clinicalPatientId: 7,
      patientAge: 45,
      patientGender: 'male',
    })),
    getDurationSec: vi.fn(async () => 75),
    setAiRequestedAt: vi.fn(async (id, attempt, at) => {
      if (!processing(attempt)) return false;
      consultation.aiRequestedAt = at;
      return true;
    }),
    markFailed: vi.fn(async (id, failureReason, attempt) => {
      if (!processing(attempt)) return null;
      Object.assign(consultation, { status: 'failed', failureReason });
      return { consultationId: id, doctorId: DOCTOR_ID };
    }),
    saveSoapNote: vi.fn(async (id, attempt, note) => {
      if (!processing(attempt) || notes.length > 0) return null;
      consultation.status = 'completed';
      const row = { soapNoteId: 39, consultationId: id, ...note };
      notes.push(row);
      return row;
    }),
    markTimedOut: vi.fn(async () => []),
  };
  const transcriptRepository = {
    findWindows: vi.fn(async () => [
      { windowNo: 1, transcriptText: 'Doctor: Kya masla hai?\nPatient: Gala kharab hai.' },
      { windowNo: 2, transcriptText: 'Doctor: Panadol 500 mg, din mein 2 baar.\n' },
    ]),
  };
  const transcriptionService = { transcribeMissing: vi.fn(async () => ({ failedWindowNos: [] })) };
  const eventPublisher = { publish: vi.fn(async (type, data) => ({ type, data })) };
  const sseManager = { send: vi.fn() };
  const service = new SoapNoteService({
    soapNoteRepository,
    transcriptRepository,
    transcriptionService,
    eventPublisher,
    sseManager,
    aiAnswerTimeoutSec: 60,
    logger: createLogger('test', 'silent'),
  });
  const notifyDoctor = vi.spyOn(service, 'notifyDoctor');

  return {
    service,
    consultation,
    notes,
    soapNoteRepository,
    transcriptRepository,
    transcriptionService,
    eventPublisher,
    sseManager,
    notifyDoctor,
  };
}

const generated = (overrides = {}) => ({
  consultationId: CONSULTATION_ID,
  attempt: 1,
  subjective: 'Sore throat for 3 days.',
  objective: '',
  assessment: 'Likely viral throat infection.',
  plan: 'Panadol 500 mg, 1 tablet, twice a day, 3 days\nWarm salt water gargles.',
  aiResult: AI_RESULT,
  ...overrides,
});

describe('SoapNoteService', () => {
  let ctx;

  beforeEach(() => {
    ctx = createContext();
  });

  describe('finishTranscript (consultation.recorded)', () => {
    it('transcribes the missing minutes, joins them in order and sends transcript.ready', async () => {
      await ctx.service.finishTranscript(CONSULTATION_ID, 8);

      expect(ctx.transcriptionService.transcribeMissing).toHaveBeenCalledWith(CONSULTATION_ID, 8);
      expect(ctx.soapNoteRepository.getDurationSec).toHaveBeenCalledWith(CONSULTATION_ID, 8);
      expect(ctx.consultation.aiRequestedAt).toBeInstanceOf(Date);
      expect(ctx.eventPublisher.publish).toHaveBeenCalledExactlyOnceWith('transcript.ready', {
        consultationId: CONSULTATION_ID,
        attempt: 1,
        patientAge: 45,
        patientGender: 'male',
        durationSec: 75,
        transcript: 'Doctor: Kya masla hai?\nPatient: Gala kharab hai.\nDoctor: Panadol 500 mg, din mein 2 baar.',
      });
    });

    it('sends the current attempt after a retry', async () => {
      ctx.consultation.soapAttempt = 3;
      await ctx.service.finishTranscript(CONSULTATION_ID, 8);
      expect(ctx.eventPublisher.publish.mock.calls[0][1].attempt).toBe(3);
    });

    it('marks the consultation failed with TRANSCRIPTION_FAILED when a minute still fails', async () => {
      ctx.transcriptionService.transcribeMissing.mockResolvedValueOnce({ failedWindowNos: [2] });

      await ctx.service.finishTranscript(CONSULTATION_ID, 8);

      expect(ctx.consultation).toMatchObject({ status: 'failed', failureReason: 'TRANSCRIPTION_FAILED' });
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
      expect(ctx.notifyDoctor).toHaveBeenCalledWith(DOCTOR_ID, 'consultation_failed', {
        consultationId: CONSULTATION_ID,
        failureReason: 'TRANSCRIPTION_FAILED',
        message: FAILURE_MESSAGES.TRANSCRIPTION_FAILED,
      });
    });

    it('marks the consultation failed with NO_SPEECH and sends nothing to the AI Pipeline when the transcript is empty', async () => {
      ctx.transcriptRepository.findWindows.mockResolvedValueOnce([
        { windowNo: 1, transcriptText: '' },
        { windowNo: 2, transcriptText: '  \n' },
      ]);

      await ctx.service.finishTranscript(CONSULTATION_ID, 1);

      expect(ctx.consultation).toMatchObject({ status: 'failed', failureReason: 'NO_SPEECH', aiRequestedAt: null });
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
      expect(ctx.notifyDoctor).toHaveBeenCalledWith(DOCTOR_ID, 'consultation_failed', {
        consultationId: CONSULTATION_ID,
        failureReason: 'NO_SPEECH',
        message: FAILURE_MESSAGES.NO_SPEECH,
      });
    });

    it('failTranscript (dead letter) marks a processing consultation TRANSCRIPTION_FAILED and tells the doctor', async () => {
      await ctx.service.failTranscript(CONSULTATION_ID);

      expect(ctx.consultation).toMatchObject({ status: 'failed', failureReason: 'TRANSCRIPTION_FAILED' });
      expect(ctx.notifyDoctor).toHaveBeenCalledWith(DOCTOR_ID, 'consultation_failed', expect.objectContaining({ failureReason: 'TRANSCRIPTION_FAILED' }));
    });

    it('failTranscript changes nothing for a consultation that already finished', async () => {
      ctx.consultation.status = 'completed';
      await ctx.service.failTranscript(CONSULTATION_ID);
      expect(ctx.consultation.status).toBe('completed');
      expect(ctx.notifyDoctor).not.toHaveBeenCalled();
    });

    it.each([['completed'], ['failed'], ['recording']])('skips a consultation that is %s', async (status) => {
      ctx.consultation.status = status;
      await ctx.service.finishTranscript(CONSULTATION_ID, 8);
      expect(ctx.transcriptionService.transcribeMissing).not.toHaveBeenCalled();
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('skips a consultation that already has a note', async () => {
      ctx.notes.push({ soapNoteId: 1 });
      await ctx.service.finishTranscript(CONSULTATION_ID, 8);
      expect(ctx.transcriptionService.transcribeMissing).not.toHaveBeenCalled();
    });

    it('throws when transcript.ready cannot be sent, so the retry queue tries again', async () => {
      ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));
      await expect(ctx.service.finishTranscript(CONSULTATION_ID, 8)).rejects.toThrow('not connected');
    });
  });

  describe('saveGenerated (soap.generated)', () => {
    it('saves the note and aiResult as they are, sets completed, sends soap.ready and tells the doctor', async () => {
      await ctx.service.saveGenerated(generated());

      expect(ctx.soapNoteRepository.saveSoapNote).toHaveBeenCalledWith(CONSULTATION_ID, 1, {
        subjective: 'Sore throat for 3 days.',
        objective: '',
        assessment: 'Likely viral throat infection.',
        plan: 'Panadol 500 mg, 1 tablet, twice a day, 3 days\nWarm salt water gargles.',
        aiResult: AI_RESULT,
      });
      expect(ctx.notes[0].aiResult).toBe(AI_RESULT);
      expect(ctx.consultation.status).toBe('completed');
      expect(ctx.eventPublisher.publish).toHaveBeenCalledExactlyOnceWith('soap.ready', {
        consultationId: CONSULTATION_ID,
        soapNoteId: 39,
        doctorId: DOCTOR_ID,
        clinicalPatientId: 7,
        patientAge: 45,
        plan: 'Panadol 500 mg, 1 tablet, twice a day, 3 days\nWarm salt water gargles.',
      });
      expect(ctx.notifyDoctor).toHaveBeenCalledWith(DOCTOR_ID, 'soap_ready', { consultationId: CONSULTATION_ID });
    });

    it('sends soap_ready to the doctor by SSE', async () => {
      await ctx.service.saveGenerated(generated());
      expect(ctx.sseManager.send).toHaveBeenCalledExactlyOnceWith(DOCTOR_ID, 'soap_ready', {
        consultationId: CONSULTATION_ID,
      });
    });

    it('saves null parts as empty strings', async () => {
      await ctx.service.saveGenerated(generated({ objective: null, assessment: undefined }));
      expect(ctx.notes[0]).toMatchObject({ objective: '', assessment: '' });
    });

    it('ignores an answer for an old attempt', async () => {
      ctx.consultation.soapAttempt = 2;

      await ctx.service.saveGenerated(generated({ attempt: 1 }));

      expect(ctx.soapNoteRepository.saveSoapNote).not.toHaveBeenCalled();
      expect(ctx.consultation.status).toBe('processing');
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
      expect(ctx.notifyDoctor).not.toHaveBeenCalled();
    });

    it('ignores a repeated soap.generated', async () => {
      await ctx.service.saveGenerated(generated());
      await ctx.service.saveGenerated(generated({ plan: 'Another plan' }));

      expect(ctx.notes).toHaveLength(1);
      expect(ctx.notes[0].plan).not.toBe('Another plan');
      expect(ctx.eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(ctx.notifyDoctor).toHaveBeenCalledTimes(1);
    });

    it('ignores an answer when the consultation has already failed (for example, timed out)', async () => {
      Object.assign(ctx.consultation, { status: 'failed', failureReason: 'AI_TIMEOUT' });
      await ctx.service.saveGenerated(generated());
      expect(ctx.notes).toHaveLength(0);
    });

    it('does nothing more when the save finds the answer stale (two copies at once)', async () => {
      ctx.soapNoteRepository.saveSoapNote.mockResolvedValueOnce(null);
      await ctx.service.saveGenerated(generated());
      expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
      expect(ctx.notifyDoctor).not.toHaveBeenCalled();
    });

    it('still tells the doctor when soap.ready cannot be sent', async () => {
      ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));
      await ctx.service.saveGenerated(generated());
      expect(ctx.notes).toHaveLength(1);
      expect(ctx.notifyDoctor).toHaveBeenCalledWith(DOCTOR_ID, 'soap_ready', { consultationId: CONSULTATION_ID });
    });
  });

  describe('markAiFailed (soap.generation.failed)', () => {
    const failed = (attempt) => ({ consultationId: CONSULTATION_ID, attempt, reason: 'AI_NOT_AVAILABLE', message: 'x' });

    it('marks the current attempt failed with AI_FAILED and tells the doctor', async () => {
      await ctx.service.markAiFailed(failed(1));

      expect(ctx.soapNoteRepository.markFailed).toHaveBeenCalledWith(CONSULTATION_ID, 'AI_FAILED', 1);
      expect(ctx.consultation).toMatchObject({ status: 'failed', failureReason: 'AI_FAILED' });
      expect(ctx.notifyDoctor).toHaveBeenCalledWith(DOCTOR_ID, 'consultation_failed', {
        consultationId: CONSULTATION_ID,
        failureReason: 'AI_FAILED',
        message: FAILURE_MESSAGES.AI_FAILED,
      });
    });

    it('ignores an old attempt', async () => {
      ctx.consultation.soapAttempt = 2;
      await ctx.service.markAiFailed(failed(1));
      expect(ctx.consultation.status).toBe('processing');
      expect(ctx.notifyDoctor).not.toHaveBeenCalled();
    });

    it('ignores it when the note is already saved', async () => {
      ctx.consultation.status = 'completed';
      await ctx.service.markAiFailed(failed(1));
      expect(ctx.consultation.status).toBe('completed');
      expect(ctx.notifyDoctor).not.toHaveBeenCalled();
    });
  });

  describe('failTimedOut (AI answer check)', () => {
    it('fails the consultations that waited longer than the timeout and tells each doctor', async () => {
      ctx.soapNoteRepository.markTimedOut.mockResolvedValueOnce([
        { consultationId: 41, doctorId: 16 },
        { consultationId: 42, doctorId: 17 },
      ]);
      const before = Date.now();

      await ctx.service.failTimedOut();

      const [requestedBefore] = ctx.soapNoteRepository.markTimedOut.mock.calls[0];
      expect(requestedBefore.getTime()).toBeGreaterThanOrEqual(before - 60_000);
      expect(requestedBefore.getTime()).toBeLessThanOrEqual(Date.now() - 60_000);
      expect(ctx.notifyDoctor.mock.calls).toEqual([
        [16, 'consultation_failed', { consultationId: 41, failureReason: 'AI_TIMEOUT', message: FAILURE_MESSAGES.AI_TIMEOUT }],
        [17, 'consultation_failed', { consultationId: 42, failureReason: 'AI_TIMEOUT', message: FAILURE_MESSAGES.AI_TIMEOUT }],
      ]);
    });

    it('does nothing when no consultation waited too long', async () => {
      await ctx.service.failTimedOut();
      expect(ctx.notifyDoctor).not.toHaveBeenCalled();
    });
  });
});
