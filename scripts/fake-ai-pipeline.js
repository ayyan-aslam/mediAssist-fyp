// A stand-in for the AI Pipeline (agent/), for testing the Consultation Service before the real agent runs.
// Reads ai-pipeline.transcript.ready (6.4.3) and after 3 seconds answers soap.generated (6.4.4) with a simple
// note, copying consultationId and attempt. It only connects: the Consultation Service creates the queues.
// It is never started by docker compose.
//
// Usage (PowerShell, from the repo root, with the Consultation Service running):
//   node --env-file=.env scripts/fake-ai-pipeline.js            # answers soap.generated
//   node --env-file=.env scripts/fake-ai-pipeline.js --fail     # answers soap.generation.failed (6.4.5)
//   node --env-file=.env scripts/fake-ai-pipeline.js --silent   # never answers (the AI answer check fails it)
// Stop with Ctrl+C.
import { createLogger, EventConsumer, EventPublisher, RabbitConnection } from '@mediassist/common';

const ANSWER_DELAY_MS = 3000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const args = process.argv.slice(2);
const mode = args.includes('--fail') ? 'fail' : args.includes('--silent') ? 'silent' : 'normal';
if (!process.env.RABBITMQ_URL) {
  console.error('Error: set RABBITMQ_URL (run with: node --env-file=.env scripts/fake-ai-pipeline.js).');
  process.exit(1);
}

const logger = createLogger('fake-ai-pipeline', process.env.LOG_LEVEL ?? 'info');
const rabbit = new RabbitConnection({ url: process.env.RABBITMQ_URL, logger });
const publisher = new EventPublisher({ connection: rabbit, source: 'ai-pipeline', logger });

// A small result in the shape of the AI Pipeline's aiResult (schema_version 1.0).
function fakeNote(transcript) {
  const firstPatientLine = transcript.split('\n').find((line) => line.startsWith('Patient:')) ?? '';
  const subjective = `Fake note. Patient said: ${firstPatientLine.replace(/^Patient:\s*/, '').slice(0, 200)}`;
  const prescription = [
    { name: 'Panadol', strength: '500 mg', dose: '1 tablet', frequency: 'twice a day', duration: '3 days', tag: 'doctor_prescribed' },
  ];
  const notes = 'Drink plenty of water.';
  return {
    subjective,
    objective: '',
    assessment: 'Fake assessment from the fake AI pipeline.',
    plan: `Panadol, 500 mg, 1 tablet, twice a day, 3 days\n${notes}`,
    aiResult: {
      schema_version: '1.0',
      soap: {
        subjective,
        objective: null,
        assessment: 'Fake assessment from the fake AI pipeline.',
        plan: { notes, prescription, for_doctor_review: [] },
        medication_history: [],
      },
      symptoms: [],
      warnings: ['Made by scripts/fake-ai-pipeline.js, not by the real AI Pipeline.'],
    },
  };
}

async function answer({ data }) {
  const { consultationId, attempt, transcript } = data;
  logger.info({ consultationId, attempt, mode, transcriptChars: transcript?.length ?? 0 }, 'Got transcript.ready');
  if (mode === 'silent') return;

  await sleep(ANSWER_DELAY_MS);
  if (mode === 'fail') {
    await publisher.publish('soap.generation.failed', {
      consultationId,
      attempt,
      reason: 'INTERNAL_ERROR',
      message: 'The fake AI pipeline was started with --fail.',
    });
    logger.info({ consultationId, attempt }, 'Sent soap.generation.failed');
    return;
  }
  await publisher.publish('soap.generated', { consultationId, attempt, ...fakeNote(transcript ?? '') });
  logger.info({ consultationId, attempt }, 'Sent soap.generated');
}

new EventConsumer({ connection: rabbit, logger }).consume('ai-pipeline.transcript.ready', answer, { prefetch: 1 });
await rabbit.start();
logger.info({ mode }, 'Fake AI pipeline is waiting for transcript.ready');

async function shutdown() {
  await rabbit.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
