import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, createLogger, errorHandler, loadConfig, validate } from '../src/index.js';

const logger = createLogger('test', 'silent');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.post('/items', validate(z.object({ name: z.string().min(1) })), (req, res) => res.json(req.body));
  app.get('/conflict', () => {
    throw new AppError(409, 'ALREADY_ACTIVE', 'The account is already active.');
  });
  app.get('/crash', () => {
    throw new Error('database password is wrong');
  });
  app.use(errorHandler(logger));
  return app;
}

describe('errorHandler', () => {
  it('returns the status and code of an AppError', async () => {
    const res = await request(createTestApp()).get('/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'ALREADY_ACTIVE', message: 'The account is already active.' } });
  });

  it('returns 500 INTERNAL_ERROR without the details of an unknown error', async () => {
    const res = await request(createTestApp()).get('/crash');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('returns 400 VALIDATION_ERROR for invalid JSON', async () => {
    const res = await request(createTestApp()).post('/items').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('validate', () => {
  it('returns 400 VALIDATION_ERROR when the body is wrong', async () => {
    const res = await request(createTestApp()).post('/items').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/^name: /);
  });

  it('passes valid data to the handler', async () => {
    const res = await request(createTestApp()).post('/items').send({ name: 'Panadol' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Panadol' });
  });
});

describe('loadConfig', () => {
  const schema = z.object({ DATABASE_URL: z.url(), PORT: z.coerce.number().default(3000) });

  it('returns the parsed values', () => {
    expect(loadConfig(schema, { DATABASE_URL: 'postgresql://localhost/db' })).toEqual({
      DATABASE_URL: 'postgresql://localhost/db',
      PORT: 3000,
    });
  });

  it('throws an error that names the missing variable', () => {
    expect(() => loadConfig(schema, {})).toThrow(/DATABASE_URL/);
  });
});
