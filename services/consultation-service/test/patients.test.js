import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

describe('clinic patients', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  const addPatient = (body = validPatient, doctorId) => ctx.as(doctorId).post('/clinical-patients').send(body);

  describe('POST /clinical-patients', () => {
    it('adds a patient and returns 201 with the clinic patient object', async () => {
      const res = await addPatient();

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        clinicalPatientId: 1,
        fullName: 'Bilal Hussain',
        phone: '03214567890',
        email: null,
        age: 45,
        gender: 'male',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    it('saves the doctor ID from the gateway header, not from the body', async () => {
      await addPatient({ ...validPatient, doctorId: OTHER_DOCTOR_ID });
      expect(ctx.patients[0].doctorId).toBe(16);
    });

    it('treats a missing email as null and keeps an Urdu name as it is', async () => {
      const { email, ...withoutEmail } = validPatient;
      const res = await addPatient({ ...withoutEmail, fullName: 'بلال حسین' });

      expect(res.status).toBe(201);
      expect(res.body.email).toBeNull();
      expect(res.body.fullName).toBe('بلال حسین');
    });

    it('returns 409 PHONE_ALREADY_SAVED when the doctor already saved this phone', async () => {
      await addPatient();
      const res = await addPatient({ ...validPatient, fullName: 'Someone Else' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'PHONE_ALREADY_SAVED', message: 'You have already saved a patient with this phone number.' },
      });
    });

    it('lets another doctor save the same phone', async () => {
      await addPatient();
      const res = await addPatient(validPatient, OTHER_DOCTOR_ID);
      expect(res.status).toBe(201);
    });

    it.each([
      ['a missing name', { fullName: undefined }],
      ['an empty name', { fullName: '   ' }],
      ['a wrong phone', { phone: '12ab' }],
      ['a wrong email', { email: 'not-an-email' }],
      ['an age above 120', { age: 121 }],
      ['a negative age', { age: -1 }],
      ['an age that is not a whole number', { age: 4.5 }],
      ['an unknown gender', { gender: 'unknown' }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, change) => {
      const res = await addPatient({ ...validPatient, ...change });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(ctx.patients).toHaveLength(0);
    });

    it('returns 401 without the gateway user headers', async () => {
      const res = await request(ctx.app).post('/clinical-patients').send(validPatient);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 for a user who is not a doctor', async () => {
      const res = await ctx.as(15, 'patient').post('/clinical-patients').send(validPatient);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /clinical-patients?phone=', () => {
    it('returns found true with the patient', async () => {
      await addPatient();
      const res = await ctx.as().get('/clinical-patients?phone=03214567890');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        found: true,
        patient: expect.objectContaining({ clinicalPatientId: 1, fullName: 'Bilal Hussain', phone: '03214567890' }),
      });
    });

    it('returns found false when the phone is not saved', async () => {
      const res = await ctx.as().get('/clinical-patients?phone=03001112223');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ found: false, patient: null });
    });

    it('returns found false for a phone saved only by another doctor', async () => {
      await addPatient();
      const res = await ctx.as(OTHER_DOCTOR_ID).get('/clinical-patients?phone=03214567890');
      expect(res.body).toEqual({ found: false, patient: null });
    });

    it.each([
      ['no phone', '/clinical-patients'],
      ['a wrong phone', '/clinical-patients?phone=abc'],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, url) => {
      const res = await ctx.as().get(url);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /clinical-patients/{patientId}', () => {
    it('returns the clinic patient object', async () => {
      const created = (await addPatient()).body;
      const res = await ctx.as().get('/clinical-patients/1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(created);
    });

    it('returns 404 PATIENT_NOT_FOUND for another doctor’s patient', async () => {
      await addPatient();
      const res = await ctx.as(OTHER_DOCTOR_ID).get('/clinical-patients/1');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'PATIENT_NOT_FOUND', message: 'This patient was not found.' } });
    });

    it.each(['99', 'abc', '0', '1.5', '99999999999'])('returns 404 PATIENT_NOT_FOUND for ID %s', async (id) => {
      const res = await ctx.as().get(`/clinical-patients/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PATIENT_NOT_FOUND');
    });
  });

  describe('PATCH /clinical-patients/{patientId}', () => {
    beforeEach(async () => {
      await addPatient();
    });

    it('changes only the fields that are sent', async () => {
      const res = await ctx.as().patch('/clinical-patients/1').send({ email: 'Bilal@Example.com', age: 46 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        clinicalPatientId: 1,
        fullName: 'Bilal Hussain',
        phone: '03214567890',
        email: 'bilal@example.com',
        age: 46,
        gender: 'male',
      });
    });

    it('removes the email when null is sent', async () => {
      await ctx.as().patch('/clinical-patients/1').send({ email: 'bilal@example.com' });
      const res = await ctx.as().patch('/clinical-patients/1').send({ email: null });
      expect(res.body.email).toBeNull();
    });

    it('returns 409 PHONE_ALREADY_SAVED when the new phone belongs to another of the doctor’s patients', async () => {
      await addPatient({ ...validPatient, phone: '03001112223' });
      const res = await ctx.as().patch('/clinical-patients/2').send({ phone: '03214567890' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_ALREADY_SAVED');
    });

    it('accepts the patient’s own current phone', async () => {
      const res = await ctx.as().patch('/clinical-patients/1').send({ phone: '03214567890' });
      expect(res.status).toBe(200);
    });

    it('returns 404 PATIENT_NOT_FOUND for another doctor’s patient and changes nothing', async () => {
      const res = await ctx.as(OTHER_DOCTOR_ID).patch('/clinical-patients/1').send({ age: 50 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PATIENT_NOT_FOUND');
      expect(ctx.patients[0].age).toBe(45);
    });

    it.each([
      ['an unknown field', { doctorId: 17 }],
      ['a null name', { fullName: null }],
      ['a null age', { age: null }],
      ['a wrong gender', { gender: 'x' }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, body) => {
      const res = await ctx.as().patch('/clinical-patients/1').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
