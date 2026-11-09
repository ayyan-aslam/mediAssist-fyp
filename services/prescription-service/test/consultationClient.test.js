import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsultationClient } from '../src/clients/ConsultationClient.js';

// A fake Consultation Service internal API.
let server;
let baseUrl;
const calls = [];

beforeAll(async () => {
  const fake = express();
  fake.use((req, res) => {
    calls.push(req.url);
    if (req.url.startsWith('/internal/consultations/41/prescription-source')) {
      return res.json({ consultationId: 41, medicines: [] });
    }
    if (req.url === '/internal/consultations/41/patient-contact') {
      return res.json({ fullName: 'Ali Raza', email: 'ali@example.com' });
    }
    if (req.url.startsWith('/internal/consultations/42/')) {
      return res.status(409).json({ error: { code: 'SOAP_NOT_READY', message: 'The SOAP note is not ready yet.' } });
    }
    if (req.url.startsWith('/internal/consultations/43/')) {
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
    }
    return res.status(404).json({ error: { code: 'CONSULTATION_NOT_FOUND', message: 'This consultation was not found.' } });
  });
  await new Promise((resolve) => {
    server = fake.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

describe('ConsultationClient', () => {
  it('reads prescription-source with the doctor, and patient-contact', async () => {
    const client = new ConsultationClient({ baseUrl });
    expect(await client.getPrescriptionSource(41, 16)).toEqual({ consultationId: 41, medicines: [] });
    expect(calls).toContain('/internal/consultations/41/prescription-source?doctorId=16');
    expect(await client.getPatientContact(41)).toEqual({ fullName: 'Ali Raza', email: 'ali@example.com' });
  });

  it('passes on 404 CONSULTATION_NOT_FOUND and 409 SOAP_NOT_READY', async () => {
    const client = new ConsultationClient({ baseUrl });
    await expect(client.getPrescriptionSource(99, 16)).rejects.toMatchObject({ status: 404, code: 'CONSULTATION_NOT_FOUND' });
    await expect(client.getPrescriptionSource(42, 16)).rejects.toMatchObject({ status: 409, code: 'SOAP_NOT_READY' });
  });

  it('returns 503 SERVICE_UNAVAILABLE on a server error or when the service is down', async () => {
    await expect(new ConsultationClient({ baseUrl }).getPatientContact(43)).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(new ConsultationClient({ baseUrl: 'http://127.0.0.1:1' }).getPatientContact(41)).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
