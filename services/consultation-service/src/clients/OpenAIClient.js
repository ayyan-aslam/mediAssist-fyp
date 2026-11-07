import { readFile } from 'node:fs/promises';
import OpenAI, { toFile } from 'openai';

const promptsDir = new URL('../../prompts/', import.meta.url);

// Reads a prompt from prompts/, so the prompts can be tuned without changing code.
export async function loadPrompt(fileName) {
  return (await readFile(new URL(fileName, promptsDir), 'utf8')).trim();
}

// OpenAI speech-to-text and the GPT clean-up of one minute (design doc 3.4.4). Kept small, so tests can
// replace it. No retries here: a failed minute goes to the RabbitMQ retry queue and is tried again there.
export class OpenAIClient {
  constructor({ apiKey, transcribeModel, cleanupModel, timeoutSec, cleanupPrompt, openai }) {
    this.transcribeModel = transcribeModel;
    this.cleanupModel = cleanupModel;
    this.cleanupPrompt = cleanupPrompt;
    this.openai = openai ?? new OpenAI({ apiKey, timeout: timeoutSec * 1000, maxRetries: 0 });
  }

  // audio: an MP3 Buffer. The languages field is not sent: the audio mixes Urdu, Punjabi and English.
  async transcribe(audio, prompt) {
    const transcription = await this.openai.audio.transcriptions.create({
      file: await toFile(audio, 'minute.mp3', { type: 'audio/mpeg' }),
      model: this.transcribeModel,
      prompt,
    });
    return transcription.text.trim();
  }

  // Adds the Doctor and Patient labels and removes the overlap words (prompts/transcript-cleanup.md).
  async cleanUp(previousText, rawText) {
    const completion = await this.openai.chat.completions.create({
      model: this.cleanupModel,
      temperature: 0,
      messages: [
        { role: 'system', content: this.cleanupPrompt },
        {
          role: 'user',
          content:
            `<previous_minute>\n${previousText || '(none, this is the first minute)'}\n</previous_minute>\n\n` +
            `<new_raw_text>\n${rawText}\n</new_raw_text>`,
        },
      ],
    });
    return (completion.choices[0].message.content ?? '').trim();
  }
}
