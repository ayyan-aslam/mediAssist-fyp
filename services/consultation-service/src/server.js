import { EventConsumer, EventPublisher, RabbitConnection, setupTopology } from '@mediassist/common';
import { createApp } from './app.js';
import { loadPrompt, OpenAIClient } from './clients/OpenAIClient.js';
import { S3Client } from './clients/S3Client.js';
import { config } from './config.js';
import { createPrismaClient } from './db/prisma.js';
import { logger } from './logger.js';
import { ConsultationRepository } from './repositories/ConsultationRepository.js';
import { PatientRepository } from './repositories/PatientRepository.js';
import { SoapNoteRepository } from './repositories/SoapNoteRepository.js';
import { TranscriptRepository } from './repositories/TranscriptRepository.js';
import { AudioMerger } from './services/AudioMerger.js';
import { SoapNoteService } from './services/SoapNoteService.js';
import { SseManager } from './services/SseManager.js';
import { TranscriptionService } from './services/TranscriptionService.js';

// The AI answer check runs this often (design doc 3.8).
const AI_ANSWER_CHECK_MS = 15_000;

// The config is checked on import (./config.js). Then RabbitMQ, then the HTTP server.
const prisma = createPrismaClient(config.CONSULTATION_DATABASE_URL);

// This service creates the exchange and all queues (design doc 6.2.2). setupTopology() runs again after
// every reconnect. The server waits for the first run, so no message is sent before its queue exists.
const rabbit = new RabbitConnection({ url: config.RABBITMQ_URL, logger });
const topologyReady = new Promise((resolve) => {
  rabbit.onConnect(async (model) => {
    await setupTopology(model);
    logger.info('RabbitMQ exchange and queues are ready');
    resolve();
  });
});

const eventPublisher = new EventPublisher({ connection: rabbit, source: 'consultation-service', logger });
const consultationRepository = new ConsultationRepository(prisma);
const transcriptRepository = new TranscriptRepository(prisma);
const s3Client = new S3Client({
  region: config.AWS_REGION,
  accessKeyId: config.AWS_ACCESS_KEY_ID,
  secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  bucket: config.S3_BUCKET_NAME,
});

// Transcription module: reads audio.window.ready and transcribes each minute (design doc Diagram 6 Part 1).
// Registered after the topology, so its queue exists before it is read.
const transcriptionService = new TranscriptionService({
  transcriptRepository,
  consultationRepository,
  s3Client,
  audioMerger: new AudioMerger(),
  openAIClient: new OpenAIClient({
    apiKey: config.OPENAI_API_KEY,
    transcribeModel: config.OPENAI_TRANSCRIBE_MODEL,
    cleanupModel: config.OPENAI_CLEANUP_MODEL,
    timeoutSec: config.OPENAI_TIMEOUT_SEC,
    cleanupPrompt: await loadPrompt('transcript-cleanup.md'),
  }),
  transcriptionContext: await loadPrompt('transcription-context.md'),
  overlapParts: config.TRANSCRIPTION_OVERLAP_PARTS,
  logger,
});
// The doctors' open live update streams (design doc 3.7).
const sseManager = new SseManager({ logger });

// Stop, AI Pipeline answers and the AI answer check (design doc Diagram 6 Parts 2 and 3).
const soapNoteService = new SoapNoteService({
  soapNoteRepository: new SoapNoteRepository(prisma),
  transcriptRepository,
  transcriptionService,
  eventPublisher,
  sseManager,
  aiAnswerTimeoutSec: config.AI_ANSWER_TIMEOUT_SEC,
  logger,
});

const eventConsumer = new EventConsumer({ connection: rabbit, logger });
eventConsumer.consume(
  'consultation.audio.window.ready',
  ({ data }) => transcriptionService.transcribeWindow(data.consultationId, data.windowNo),
  { prefetch: 5 },
);
eventConsumer.consume(
  'consultation.consultation.recorded',
  ({ data }) => soapNoteService.finishTranscript(data.consultationId, data.totalParts),
  { prefetch: 5 },
);
eventConsumer.consume('consultation.soap.generated', ({ data }) => soapNoteService.saveGenerated(data), {
  prefetch: 5,
});
eventConsumer.consume('consultation.soap.generation.failed', ({ data }) => soapNoteService.markAiFailed(data), {
  prefetch: 5,
});

await rabbit.start();
logger.info('Waiting for RabbitMQ to create the exchange and queues');
await topologyReady;

const app = createApp({
  logger,
  patientRepository: new PatientRepository(prisma),
  consultationRepository,
  transcriptRepository,
  s3Client,
  eventPublisher,
  sseManager,
});

const aiAnswerCheck = setInterval(() => {
  soapNoteService.failTimedOut().catch((err) => logger.error({ err }, 'AI answer check failed'));
}, AI_ANSWER_CHECK_MS);

const server = app.listen(config.CONSULTATION_SERVICE_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Consultation service could not start');
    process.exit(1);
  }
  logger.info(`Consultation service listening on port ${config.CONSULTATION_SERVICE_PORT}`);
});

function shutdown() {
  clearInterval(aiAnswerCheck);
  sseManager.closeAll();
  server.close(async () => {
    await rabbit.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
