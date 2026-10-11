import pino from 'pino';

export function createLogger(name, level = process.env.LOG_LEVEL ?? 'info') {
  return pino({ name, level });
}
