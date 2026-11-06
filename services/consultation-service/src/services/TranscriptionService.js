import { setTimeout as sleep } from 'node:timers/promises';
import { PARTS_PER_WINDOW } from './ConsultationService.js';

const LABEL = /^(Doctor|Patient|Other):\s*/;
const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// The speech-to-text prompt: the previous minute's text plus the note, with no line breaks, "<" or ">".
export function speechPrompt(previousText, note) {
  return `${previousText} ${note}`.replace(/[\r\n<>]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// True when every line starts with "Doctor:", "Patient:" or "Other:".
export function hasLabels(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .every((line) => LABEL.test(line));
}

// A repeat shorter than this (letters and digits) is removed only when the same speaker said it,
// so a new "Salam" from the patient is not taken for the doctor's "Salam".
const MIN_REPEAT_LENGTH = 12;
const LINES_TO_CHECK = 3;

// Safety net after the clean-up: if the text still starts with the last line of the previous minute
// (compared without labels, spaces and punctuation), that part is removed. The clean-up sometimes keeps
// the last 2 or 3 lines, or gives them another label, so the end of the previous minute is checked too,
// longest first.
export function removeRepeatedStart(previousText, text) {
  const previousLines = previousText.trim().split('\n');
  for (let count = Math.min(LINES_TO_CHECK, previousLines.length); count >= 1; count -= 1) {
    const lines = previousLines.slice(-count);
    const repeated = normalize(lines.map((line) => line.replace(LABEL, '')).join(' '));
    const sameSpeaker = count === 1 && lines[0].match(LABEL)?.[1] === text.match(LABEL)?.[1];
    if (!repeated || (repeated.length < MIN_REPEAT_LENGTH && !sameSpeaker)) continue;
    const result = cutRepeated(text, repeated);
    if (result !== null) return result;
  }
  return text;
}

// Removes `repeated` (normalized) from the start of the text, across lines. Returns null when the text
// does not start with it, or when the cut would end inside a word ("Salam" must not cut "Salamat").
function cutRepeated(text, repeated) {
  const lines = text.split('\n');
  let matched = 0;
  for (const [i, line] of lines.entries()) {
    const label = line.match(LABEL)?.[0] ?? '';
    const body = line.slice(label.length);
    let cut = 0;
    for (const char of body) {
      if (matched === repeated.length) break;
      const letters = normalize(char);
      if (letters && repeated.slice(matched, matched + letters.length) !== letters) return null;
      matched += letters.length;
      cut += char.length;
    }
    // The whole line is repeated: go on with the next line.
    if (matched < repeated.length) continue;

    const rest = body.slice(cut);
    if (/^[\p{L}\p{N}]/u.test(rest)) return null;
    // Drops the spaces and punctuation left at the start, but keeps a leading [unclear].
    const remaining = rest.replace(/^[^\p{L}\p{N}\[]+/u, '');
    const result = [...(remaining ? [label + remaining] : []), ...lines.slice(i + 1)].join('\n');
    return result.trim() ? result : null;
  }
  // Everything is repeated. Keep the text rather than save an empty minute.
  return null;
}

// Turns one minute of audio into labelled text with OpenAI (design doc 3.4.4, Diagram 6 Part 1).
export class TranscriptionService {
  constructor({
    transcriptRepository,
    consultationRepository,
    s3Client,
    audioMerger,
    openAIClient,
    transcriptionContext,
    overlapParts,
    logger,
    previousWaitMs = 20_000,
    pollMs = 1000,
  }) {
    this.transcriptRepository = transcriptRepository;
    this.consultationRepository = consultationRepository;
    this.s3Client = s3Client;
    this.audioMerger = audioMerger;
    this.openAIClient = openAIClient;
    this.transcriptionContext = transcriptionContext;
    this.overlapParts = overlapParts;
    this.logger = logger;
    this.previousWaitMs = previousWaitMs;
    this.pollMs = pollMs;
  }

  // Safe to run twice: a minute that is already done is skipped. On error the minute is marked failed
  // and the error is thrown again, so the message goes to the retry queue.
  async transcribeWindow(consultationId, windowNo) {
    const window = await this.transcriptRepository.findWindow(consultationId, windowNo);
    if (!window) {
      this.logger.warn({ consultationId, windowNo }, 'Transcript window not found. Skipping it.');
      return;
    }
    if (window.status === 'done') return;

    try {
      const previousText = await this.#previousText(consultationId, windowNo);
      const audio = await this.#mergedAudio(consultationId, windowNo);

      let started = performance.now();
      const rawText = await this.openAIClient.transcribe(audio, speechPrompt(previousText, this.transcriptionContext));
      const speechMs = Math.round(performance.now() - started);

      started = performance.now();
      let text = await this.openAIClient.cleanUp(previousText, rawText);
      if (!hasLabels(text)) {
        text = await this.openAIClient.cleanUp(previousText, rawText);
        if (!hasLabels(text)) {
          this.logger.warn({ consultationId, windowNo }, 'Some transcript lines have no speaker label. Saving as it is.');
        }
      }
      const cleanUpMs = Math.round(performance.now() - started);
      if (previousText) text = removeRepeatedStart(previousText, text);

      await this.transcriptRepository.saveText(consultationId, windowNo, text);
      this.logger.info({ consultationId, windowNo, speechMs, cleanUpMs }, 'Transcribed a minute');
    } catch (err) {
      await this.transcriptRepository.updateStatus(consultationId, windowNo, 'failed');
      throw err;
    }
  }

  // The previous minute's text, needed as context and to remove the overlap. Waits up to 20 seconds
  // for it to be done (design doc 6.4.1), then fails, so the retry queue tries again.
  async #previousText(consultationId, windowNo) {
    if (windowNo === 1) return '';
    const deadline = Date.now() + this.previousWaitMs;
    for (;;) {
      const previous = await this.transcriptRepository.findWindow(consultationId, windowNo - 1);
      if (previous?.status === 'done') return previous.transcriptText ?? '';
      if (Date.now() >= deadline) {
        throw new Error(`Minute ${windowNo - 1} of consultation ${consultationId} is not transcribed yet.`);
      }
      await sleep(this.pollMs);
    }
  }

  // The parts of this minute, after the last parts of the previous minute as overlap, as one MP3.
  async #mergedAudio(consultationId, windowNo) {
    const lastPartNo = windowNo * PARTS_PER_WINDOW;
    const firstPartNo = Math.max(1, lastPartNo - PARTS_PER_WINDOW + 1 - this.overlapParts);
    const parts = await this.consultationRepository.findPartsInRange(consultationId, firstPartNo, lastPartNo);
    if (parts.length === 0) throw new Error(`Minute ${windowNo} of consultation ${consultationId} has no audio parts.`);
    const files = await Promise.all(parts.map((part) => this.s3Client.download(part.fileKey)));
    return this.audioMerger.merge(files);
  }
}
