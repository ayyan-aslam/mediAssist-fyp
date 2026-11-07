// One-off test of OpenAI transcription on sample recordings (prompt B6-test). Not part of the app.
// For each audio file in a folder: cuts it into one-minute pieces with 10 seconds of overlap, sends each
// piece to OpenAI speech-to-text, cleans the raw text with GPT, and writes both versions to a results folder.
//
// Usage (PowerShell, from services/consultation-service):
//   node --env-file=../../.env scripts/test-transcription.js <audio folder> [results folder]
//
// Needs ffmpeg and ffprobe on the PATH. Results folder default: <audio folder>/results.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from '@mediassist/common';
import { z } from 'zod';
import { loadPrompt, OpenAIClient } from '../src/clients/OpenAIClient.js';
import { speechPrompt } from '../src/services/TranscriptionService.js';

const run = promisify(execFile);

const MINUTE_SECONDS = 60;
const OVERLAP_SECONDS = 10;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.webm', '.m4a', '.mp4', '.ogg', '.opus', '.flac', '.aac']);

const config = loadConfig(
  z.object({
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_TRANSCRIBE_MODEL: z.string().min(1),
    OPENAI_CLEANUP_MODEL: z.string().min(1),
    OPENAI_TIMEOUT_SEC: z.coerce.number().positive().default(25),
  }),
);

// The same client and prompts as the service (prompts/transcript-cleanup.md, prompts/transcription-context.md).
const openai = new OpenAIClient({
  apiKey: config.OPENAI_API_KEY,
  transcribeModel: config.OPENAI_TRANSCRIBE_MODEL,
  cleanupModel: config.OPENAI_CLEANUP_MODEL,
  timeoutSec: config.OPENAI_TIMEOUT_SEC,
  cleanupPrompt: await loadPrompt('transcript-cleanup.md'),
});

async function durationSeconds(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

// Minute n covers [60n, 60n + 60), and from the second minute on starts 10 seconds earlier as overlap.
async function cutPiece(file, minute, out) {
  const start = minute === 0 ? 0 : minute * MINUTE_SECONDS - OVERLAP_SECONDS;
  const length = minute === 0 ? MINUTE_SECONDS : MINUTE_SECONDS + OVERLAP_SECONDS;
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(start), '-t', String(length), '-i', file,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k',
    out,
  ]);
}

async function timed(fn) {
  const started = performance.now();
  const result = await fn();
  return { result, seconds: ((performance.now() - started) / 1000).toFixed(1) };
}

async function testFile(file, resultsDir, context, workDir) {
  // The format is part of the name, so a.mp3 and a.webm do not overwrite each other's results.
  const { name: base, ext } = path.parse(file);
  const name = `${base}-${ext.slice(1).toLowerCase()}`;
  const minutes = Math.ceil((await durationSeconds(file)) / MINUTE_SECONDS);
  let previousText = '';
  for (let minute = 0; minute < minutes; minute += 1) {
    const piece = path.join(workDir, `${name}-minute${minute + 1}.mp3`);
    await cutPiece(file, minute, piece);

    const audio = await readFile(piece);
    const raw = await timed(() => openai.transcribe(audio, speechPrompt(previousText, context)));
    const clean = await timed(() => openai.cleanUp(previousText, raw.result));

    const out = path.join(resultsDir, `${name}-minute${minute + 1}`);
    await writeFile(`${out}.raw.txt`, `${raw.result}\n`, 'utf8');
    await writeFile(`${out}.clean.txt`, `${clean.result}\n`, 'utf8');
    console.log(`${name} minute ${minute + 1}: speech-to-text ${raw.seconds} s, clean-up ${clean.seconds} s`);
    previousText = clean.result;
  }
}

async function main() {
  const [audioDir, resultsArg] = process.argv.slice(2);
  if (!audioDir) {
    console.error('Usage: node --env-file=../../.env scripts/test-transcription.js <audio folder> [results folder]');
    process.exit(1);
  }
  const resultsDir = resultsArg ?? path.join(audioDir, 'results');
  await mkdir(resultsDir, { recursive: true });

  const context = await loadPrompt('transcription-context.md');
  const files = (await readdir(audioDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(audioDir, entry.name))
    .sort();
  if (files.length === 0) {
    console.error(`No audio files in ${audioDir}`);
    process.exit(1);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'test-transcription-'));
  try {
    for (const file of files) {
      await testFile(file, resultsDir, context, workDir);
    }
    console.log(`Results in ${resultsDir}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await main();
