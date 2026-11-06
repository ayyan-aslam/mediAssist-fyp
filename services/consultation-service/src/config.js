import { loadConfig } from '@mediassist/common';
import { z } from 'zod';

const envSchema = z.object({
  CONSULTATION_DATABASE_URL: z.url(),
  CONSULTATION_SERVICE_PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
  // Amazon S3: the audio parts.
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_NAME: z.string().min(1),
  // OpenAI: speech-to-text and the GPT clean-up of each minute (design doc 3.4.4).
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_TRANSCRIBE_MODEL: z.string().min(1),
  OPENAI_CLEANUP_MODEL: z.string().min(1),
  OPENAI_TIMEOUT_SEC: z.coerce.number().positive().default(25),
  // Parts from the end of the previous minute added at the start of each minute as overlap.
  TRANSCRIPTION_OVERLAP_PARTS: z.coerce.number().int().min(0).max(5).default(1),
  // A consultation that waited longer than this for the AI Pipeline's answer is marked failed (AI_TIMEOUT).
  AI_ANSWER_TIMEOUT_SEC: z.coerce.number().int().positive().default(60),
});

export const config = loadConfig(envSchema);
