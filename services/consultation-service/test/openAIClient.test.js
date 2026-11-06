import { describe, expect, it, vi } from 'vitest';
import { loadPrompt, OpenAIClient } from '../src/clients/OpenAIClient.js';

// The official SDK is replaced by a fake with the same two methods.
function createClient() {
  const openai = {
    audio: { transcriptions: { create: vi.fn(async () => ({ text: '  Sir mein dard hai \n' })) } },
    chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: '\nDoctor: Salam.\n' } }] })) } },
  };
  const client = new OpenAIClient({
    transcribeModel: 'gpt-transcribe',
    cleanupModel: 'gpt-4.1-mini',
    cleanupPrompt: 'CLEAN-UP RULES',
    openai,
  });
  return { client, openai };
}

describe('OpenAIClient', () => {
  it('sends the audio as an MP3 with the model and prompt, and no languages field', async () => {
    const { client, openai } = createClient();

    const text = await client.transcribe(Buffer.from('mp3 bytes'), 'previous text and note');

    expect(text).toBe('Sir mein dard hai');
    const request = openai.audio.transcriptions.create.mock.calls[0][0];
    expect(Object.keys(request).sort()).toEqual(['file', 'model', 'prompt']);
    expect(request).toMatchObject({ model: 'gpt-transcribe', prompt: 'previous text and note' });
    expect(request.file.name).toBe('minute.mp3');
    expect(request.file.type).toBe('audio/mpeg');
    expect(Buffer.from(await request.file.arrayBuffer()).toString()).toBe('mp3 bytes');
  });

  it('cleans up with temperature 0, the clean-up prompt and both texts', async () => {
    const { client, openai } = createClient();

    const text = await client.cleanUp('Doctor: Kya masla hai?', 'bukhar hai');

    expect(text).toBe('Doctor: Salam.');
    const request = openai.chat.completions.create.mock.calls[0][0];
    expect(request).toMatchObject({ model: 'gpt-4.1-mini', temperature: 0 });
    expect(request.messages[0]).toEqual({ role: 'system', content: 'CLEAN-UP RULES' });
    expect(request.messages[1].content).toContain('<previous_minute>\nDoctor: Kya masla hai?\n</previous_minute>');
    expect(request.messages[1].content).toContain('<new_raw_text>\nbukhar hai\n</new_raw_text>');
  });

  it('tells the model when there is no previous minute', async () => {
    const { client, openai } = createClient();

    await client.cleanUp('', 'salam');

    expect(openai.chat.completions.create.mock.calls[0][0].messages[1].content).toContain(
      '(none, this is the first minute)',
    );
  });

  it('reads both prompts from prompts/', async () => {
    expect(await loadPrompt('transcript-cleanup.md')).toContain('Doctor:');
    expect(await loadPrompt('transcription-context.md')).toContain('Roman');
  });
});
