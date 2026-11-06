import { createLogger } from '@mediassist/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasLabels,
  removeRepeatedStart,
  speechPrompt,
  TranscriptionService,
} from '../src/services/TranscriptionService.js';

const NOTE = 'Mixed Urdu, Punjabi and English consultation.';
const CONSULTATION_ID = 41;

// TRANSCRIPT_WINDOW and AUDIO_PART in memory. OpenAI, S3 and ffmpeg are mocked.
function createContext({ overlapParts = 1, previousWaitMs = 50 } = {}) {
  const windows = new Map();
  const window = (windowNo) => windows.get(windowNo);
  const transcriptRepository = {
    findWindow: vi.fn(async (consultationId, windowNo) => (window(windowNo) ? { ...window(windowNo) } : null)),
    saveText: vi.fn(async (consultationId, windowNo, text) => {
      Object.assign(window(windowNo), { transcriptText: text, status: 'done' });
    }),
    updateStatus: vi.fn(async (consultationId, windowNo, status) => {
      Object.assign(window(windowNo), { status });
    }),
  };
  const consultationRepository = {
    findPartsInRange: vi.fn(async (consultationId, first, last) =>
      Array.from({ length: last - first + 1 }, (_, i) => ({
        partNo: first + i,
        fileKey: `consultations/${consultationId}/parts/${first + i}.webm`,
      })),
    ),
  };
  const s3Client = { download: vi.fn(async (key) => Buffer.from(key)) };
  const audioMerger = { merge: vi.fn(async () => Buffer.from('mp3')) };
  const openAIClient = {
    transcribe: vi.fn(async () => 'Sir mein dard hai do din se'),
    cleanUp: vi.fn(async () => 'Doctor: Kya masla hai?\nPatient: Sir mein dard hai 2 din se.'),
  };
  const logger = createLogger('test', 'silent');
  vi.spyOn(logger, 'warn');
  const service = new TranscriptionService({
    transcriptRepository,
    consultationRepository,
    s3Client,
    audioMerger,
    openAIClient,
    transcriptionContext: NOTE,
    overlapParts,
    logger,
    previousWaitMs,
    pollMs: 5,
  });
  const addWindow = (windowNo, status, transcriptText = null) =>
    windows.set(windowNo, { consultationId: CONSULTATION_ID, windowNo, status, transcriptText });

  return { service, windows, addWindow, transcriptRepository, consultationRepository, s3Client, audioMerger, openAIClient, logger };
}

describe('TranscriptionService.transcribeWindow', () => {
  let ctx;
  beforeEach(() => {
    ctx = createContext();
  });

  it('transcribes the first minute without overlap and saves it as done', async () => {
    ctx.addWindow(1, 'pending');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 1);

    expect(ctx.consultationRepository.findPartsInRange).toHaveBeenCalledWith(CONSULTATION_ID, 1, 6);
    expect(ctx.s3Client.download).toHaveBeenCalledTimes(6);
    expect(ctx.audioMerger.merge).toHaveBeenCalledWith(
      [1, 2, 3, 4, 5, 6].map((n) => Buffer.from(`consultations/41/parts/${n}.webm`)),
    );
    expect(ctx.openAIClient.transcribe).toHaveBeenCalledWith(Buffer.from('mp3'), NOTE);
    expect(ctx.openAIClient.cleanUp).toHaveBeenCalledWith('', 'Sir mein dard hai do din se');
    expect(ctx.windows.get(1)).toMatchObject({
      status: 'done',
      transcriptText: 'Doctor: Kya masla hai?\nPatient: Sir mein dard hai 2 din se.',
    });
  });

  it('adds the last part of the previous minute and its text as context', async () => {
    const previous = 'Doctor: Kya masla hai?\nPatient: Doctor sahab, <bukhar> hai';
    ctx.addWindow(1, 'done', previous);
    ctx.addWindow(2, 'pending');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 2);

    expect(ctx.consultationRepository.findPartsInRange).toHaveBeenCalledWith(CONSULTATION_ID, 6, 12);
    expect(ctx.audioMerger.merge.mock.calls[0][0]).toHaveLength(7);
    const prompt = ctx.openAIClient.transcribe.mock.calls[0][1];
    expect(prompt).toBe(`Doctor: Kya masla hai? Patient: Doctor sahab, bukhar hai ${NOTE}`);
    expect(ctx.openAIClient.cleanUp).toHaveBeenCalledWith(previous, 'Sir mein dard hai do din se');
  });

  it('uses the overlap part count from the settings', async () => {
    ctx = createContext({ overlapParts: 2 });
    ctx.addWindow(2, 'done', 'Doctor: Theek hai.');
    ctx.addWindow(3, 'pending');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 3);

    expect(ctx.consultationRepository.findPartsInRange).toHaveBeenCalledWith(CONSULTATION_ID, 11, 18);
  });

  it('skips a minute that is already done', async () => {
    ctx.addWindow(1, 'done', 'Doctor: Salam.');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 1);

    expect(ctx.openAIClient.transcribe).not.toHaveBeenCalled();
    expect(ctx.transcriptRepository.saveText).not.toHaveBeenCalled();
  });

  it('skips a minute that has no row', async () => {
    await ctx.service.transcribeWindow(CONSULTATION_ID, 1);

    expect(ctx.openAIClient.transcribe).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('transcribes a failed minute again', async () => {
    ctx.addWindow(1, 'failed');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 1);

    expect(ctx.windows.get(1).status).toBe('done');
  });

  it('waits for the previous minute when it becomes done in time', async () => {
    ctx = createContext({ previousWaitMs: 1000 });
    ctx.addWindow(1, 'pending');
    ctx.addWindow(2, 'pending');
    setTimeout(() => Object.assign(ctx.windows.get(1), { status: 'done', transcriptText: 'Doctor: Salam.' }), 30);

    await ctx.service.transcribeWindow(CONSULTATION_ID, 2);

    expect(ctx.openAIClient.cleanUp).toHaveBeenCalledWith('Doctor: Salam.', expect.any(String));
    expect(ctx.windows.get(2).status).toBe('done');
  });

  it('fails and marks the minute failed when the previous minute is not done in time', async () => {
    ctx.addWindow(1, 'pending');
    ctx.addWindow(2, 'pending');

    await expect(ctx.service.transcribeWindow(CONSULTATION_ID, 2)).rejects.toThrow('not transcribed yet');

    expect(ctx.openAIClient.transcribe).not.toHaveBeenCalled();
    expect(ctx.windows.get(2).status).toBe('failed');
  });

  it('marks the minute failed and throws again when OpenAI fails', async () => {
    ctx.addWindow(1, 'pending');
    ctx.openAIClient.transcribe.mockRejectedValueOnce(new Error('timeout'));

    await expect(ctx.service.transcribeWindow(CONSULTATION_ID, 1)).rejects.toThrow('timeout');

    expect(ctx.windows.get(1)).toMatchObject({ status: 'failed', transcriptText: null });
  });

  it('marks the minute failed when S3 fails', async () => {
    ctx.addWindow(1, 'pending');
    ctx.s3Client.download.mockRejectedValueOnce(new Error('NoSuchKey'));

    await expect(ctx.service.transcribeWindow(CONSULTATION_ID, 1)).rejects.toThrow('NoSuchKey');

    expect(ctx.windows.get(1).status).toBe('failed');
  });

  it('cleans up once more when a line has no label', async () => {
    ctx.addWindow(1, 'pending');
    ctx.openAIClient.cleanUp
      .mockResolvedValueOnce('Kya masla hai?\nPatient: Bukhar hai.')
      .mockResolvedValueOnce('Doctor: Kya masla hai?\nPatient: Bukhar hai.');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 1);

    expect(ctx.openAIClient.cleanUp).toHaveBeenCalledTimes(2);
    expect(ctx.windows.get(1).transcriptText).toBe('Doctor: Kya masla hai?\nPatient: Bukhar hai.');
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it('saves the text as it is and logs a warning when the second clean-up still has no labels', async () => {
    ctx.addWindow(1, 'pending');
    ctx.openAIClient.cleanUp.mockResolvedValue('Kya masla hai?');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 1);

    expect(ctx.openAIClient.cleanUp).toHaveBeenCalledTimes(2);
    expect(ctx.windows.get(1)).toMatchObject({ status: 'done', transcriptText: 'Kya masla hai?' });
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('removes the end of the previous minute when the clean-up left it in', async () => {
    ctx.addWindow(1, 'done', 'Doctor: Kya masla hai?\nPatient: Doctor sahab, 3 din se bukhar...');
    ctx.addWindow(2, 'pending');
    ctx.openAIClient.cleanUp.mockResolvedValue('Patient: Doctor sahab 3 din se bukhar aur khansi hai.\nDoctor: Achha.');

    await ctx.service.transcribeWindow(CONSULTATION_ID, 2);

    expect(ctx.windows.get(2).transcriptText).toBe('Patient: aur khansi hai.\nDoctor: Achha.');
  });
});

describe('removeRepeatedStart', () => {
  it('keeps the text when it does not repeat the previous minute', () => {
    expect(removeRepeatedStart('Doctor: Salam.', 'Patient: Salam doctor sahab.')).toBe('Patient: Salam doctor sahab.');
  });

  it('keeps the text when the words match only part of a word', () => {
    expect(removeRepeatedStart('Doctor: Theek', 'Doctor: Theeke ho jayega.')).toBe('Doctor: Theeke ho jayega.');
  });

  it('ignores case, spaces and punctuation', () => {
    expect(removeRepeatedStart('Doctor: Panadol 500 mg, 1 tablet...', 'Doctor: panadol 500mg 1 tablet - subah aur shaam.'))
      .toBe('Doctor: subah aur shaam.');
  });

  it('drops the first line when it only repeats the previous minute', () => {
    expect(removeRepeatedStart('Patient: Shukriya.', 'Patient: Shukriya!\nDoctor: Allah hafiz.')).toBe('Doctor: Allah hafiz.');
  });

  it('removes the last 2 lines of the previous minute, even with another label (seen with real audio)', () => {
    const previous = 'Doctor: Ulti ya bukhar?\nPatient: Nahi, ulti nahi hai, bukhar bhi nahi.\nDoctor: Neend puri hoti hai?';
    const text = 'Patient: Nahi, ulti nahi hai, bukhar bhi nahi. Neend puri hoti hai?\nPatient: Nahi, der se sota hoon.';

    expect(removeRepeatedStart(previous, text)).toBe('Patient: Nahi, der se sota hoon.');
  });

  it('removes repeated lines that the clean-up kept as separate lines', () => {
    const previous = 'Patient: Theek hai doctor sahab.\nDoctor: Panadol 500 mg, 1 tablet...';
    const text = 'Patient: Theek hai doctor sahab.\nDoctor: Panadol 500 mg, 1 tablet subah.\nPatient: Achha.';

    expect(removeRepeatedStart(previous, text)).toBe('Doctor: subah.\nPatient: Achha.');
  });

  it('keeps a short repeat from another speaker', () => {
    expect(removeRepeatedStart('Doctor: Theek hai.', 'Patient: Theek hai, shukriya.')).toBe('Patient: Theek hai, shukriya.');
  });

  it('keeps the text when all of it repeats the previous minute', () => {
    expect(removeRepeatedStart('Doctor: Panadol 500 mg lein.', 'Doctor: Panadol 500 mg lein.')).toBe('Doctor: Panadol 500 mg lein.');
  });

  it('keeps a leading [unclear]', () => {
    expect(removeRepeatedStart('Doctor: Theek hai', 'Doctor: Theek hai, [unclear] din')).toBe('Doctor: [unclear] din');
  });

  it('works with Urdu letters', () => {
    expect(removeRepeatedStart('Patient: سر میں درد', 'Patient: سر میں درد ہے')).toBe('Patient: ہے');
  });
});

describe('hasLabels and speechPrompt', () => {
  it('accepts only lines that start with Doctor:, Patient: or Other:', () => {
    expect(hasLabels('Doctor: a\nPatient: b\n\nOther: c')).toBe(true);
    expect(hasLabels('Doctor: a\nb')).toBe(false);
    expect(hasLabels('Nurse: a')).toBe(false);
  });

  it('puts the previous text before the note on one line', () => {
    expect(speechPrompt('', NOTE)).toBe(NOTE);
    expect(speechPrompt('Doctor: a\r\nPatient: b', NOTE)).toBe(`Doctor: a Patient: b ${NOTE}`);
  });
});
