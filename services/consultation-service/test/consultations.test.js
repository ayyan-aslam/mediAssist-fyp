import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

describe('consultations', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.as().post('/clinical-patients').send(validPatient);
  });

  const start = (clinicalPatientId = 1, doctorId) =>
    ctx.as(doctorId).post('/consultations').send({ clinicalPatientId });

  describe('POST /consultations', () => {
    it('starts a consultation and returns 201 with status recording', async () => {
      const res = await start();

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        consultationId: 1,
        status: 'recording',
        startedAt: expect.stringMatching(/Z$/),
      });
      expect(ctx.consultations[0]).toMatchObject({ clinicalPatientId: 1, soapAttempt: 1 });
    });

    it('returns 404 PATIENT_NOT_FOUND for another doctor’s patient and creates nothing', async () => {
      const res = await start(1, OTHER_DOCTOR_ID);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'PATIENT_NOT_FOUND', message: 'This patient was not found.' } });
      expect(ctx.consultations).toHaveLength(0);
    });

    it('returns 404 PATIENT_NOT_FOUND for a patient that does not exist', async () => {
      const res = await start(99);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PATIENT_NOT_FOUND');
    });

    it.each([
      ['no clinicalPatientId', {}],
      ['a text clinicalPatientId', { clinicalPatientId: '1' }],
      ['a negative clinicalPatientId', { clinicalPatientId: -1 }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, body) => {
      const res = await ctx.as().post('/consultations').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 without the gateway user headers', async () => {
      const res = await request(ctx.app).post('/consultations').send({ clinicalPatientId: 1 });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /consultations/{consultationId}', () => {
    it('returns the consultation with the patient summary and failureReason', async () => {
      const startedAt = (await start()).body.startedAt;
      const res = await ctx.as().get('/consultations/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        consultationId: 1,
        patient: { clinicalPatientId: 1, fullName: 'Bilal Hussain', phone: '03214567890' },
        status: 'recording',
        failureReason: null,
        followUpDate: null,
        startedAt,
        endedAt: null,
      });
    });

    it('returns the failure reason, the follow-up date as YYYY-MM-DD and endedAt', async () => {
      await start();
      Object.assign(ctx.consultations[0], {
        status: 'failed',
        failureReason: 'AI_TIMEOUT',
        followUpDate: new Date('2026-10-21T00:00:00Z'),
        endedAt: new Date('2026-10-07T09:19:00Z'),
      });
      const res = await ctx.as().get('/consultations/1');

      expect(res.body).toMatchObject({
        status: 'failed',
        failureReason: 'AI_TIMEOUT',
        followUpDate: '2026-10-21',
        endedAt: '2026-10-07T09:19:00.000Z',
      });
    });

    it('returns 404 CONSULTATION_NOT_FOUND for another doctor’s consultation', async () => {
      await start();
      const res = await ctx.as(OTHER_DOCTOR_ID).get('/consultations/1');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'CONSULTATION_NOT_FOUND', message: 'This consultation was not found.' },
      });
    });

    it.each(['99', 'abc'])('returns 404 CONSULTATION_NOT_FOUND for ID %s', async (id) => {
      const res = await ctx.as().get(`/consultations/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
    });
  });

  describe('GET /internal/consultations/{consultationId}/patient-contact', () => {
    it('returns the patient name, age, gender, phone and email', async () => {
      await start();
      const res = await request(ctx.app).get('/internal/consultations/1/patient-contact');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        fullName: 'Bilal Hussain',
        age: 45,
        gender: 'male',
        phone: '03214567890',
        email: null,
      });
    });

    it('returns 404 CONSULTATION_NOT_FOUND for a consultation that does not exist', async () => {
      const res = await request(ctx.app).get('/internal/consultations/99/patient-contact');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
    });
  });
});
