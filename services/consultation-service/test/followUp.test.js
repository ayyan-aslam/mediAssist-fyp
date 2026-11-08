import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, DOCTOR_EMAIL, DOCTOR_ID, DOCTOR_NAME, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

// PUT /consultations/{id}/follow-up: design doc 5.5, Diagram 10 Part 1 and followup.changed (6.4.9).
describe('PUT /consultations/{consultationId}/follow-up', () => {
  let ctx;

  beforeEach(async () => {
    // 20:00 UTC on 7 October is already 01:00 on 8 October in Pakistan.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T20:00:00Z'));
    ctx = createTestContext();
    await ctx.as().post('/clinical-patients').send(validPatient);
    await ctx.as().post('/clinical-patients').send({ ...validPatient, phone: '03001234567', email: 'ali@example.com' });
    await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
    await ctx.as().post('/consultations').send({ clinicalPatientId: 2 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setFollowUp = (followUpDate, { consultationId = 1, doctorId } = {}) =>
    ctx.as(doctorId).put(`/consultations/${consultationId}/follow-up`).send({ followUpDate });
  const followUpMessages = () => ctx.eventPublisher.publish.mock.calls.filter(([type]) => type === 'followup.changed');

  it('saves the date and sends followup.changed with the doctor and the patient', async () => {
    const res = await setFollowUp('2026-10-21', { consultationId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consultationId: 2, followUpDate: '2026-10-21', patientReminder: true });
    expect(ctx.consultations[1].followUpDate).toEqual(new Date('2026-10-21T00:00:00Z'));
    expect(followUpMessages()).toEqual([
      [
        'followup.changed',
        {
          consultationId: 2,
          followUpDate: '2026-10-21',
          doctorId: DOCTOR_ID,
          doctorName: DOCTOR_NAME,
          doctorEmail: DOCTOR_EMAIL,
          patientName: 'Bilal Hussain',
          patientEmail: 'ali@example.com',
          changedAt: '2026-10-07T20:00:00.000Z',
        },
      ],
    ]);
  });

  it('returns patientReminder false and sends patientEmail null when the patient has no email', async () => {
    const res = await setFollowUp('2026-10-21');

    expect(res.body).toEqual({ consultationId: 1, followUpDate: '2026-10-21', patientReminder: false });
    expect(followUpMessages()[0][1]).toMatchObject({ patientEmail: null, doctorEmail: DOCTOR_EMAIL });
  });

  it('shows the date in GET /consultations/{id}', async () => {
    await setFollowUp('2026-10-21');
    const res = await ctx.as().get('/consultations/1');
    expect(res.body.followUpDate).toBe('2026-10-21');
  });

  it('changes the date and sends the message again', async () => {
    await setFollowUp('2026-10-21');
    const res = await setFollowUp('2026-10-28');

    expect(res.body.followUpDate).toBe('2026-10-28');
    expect(followUpMessages().map(([, data]) => data.followUpDate)).toEqual(['2026-10-21', '2026-10-28']);
  });

  it('removes the follow-up with null and sends followUpDate null', async () => {
    await setFollowUp('2026-10-21', { consultationId: 2 });
    const res = await setFollowUp(null, { consultationId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consultationId: 2, followUpDate: null, patientReminder: false });
    expect(ctx.consultations[1].followUpDate).toBeNull();
    expect(followUpMessages()[1][1]).toMatchObject({ followUpDate: null, patientEmail: 'ali@example.com' });
  });

  it('accepts today in Pakistan time', async () => {
    const res = await setFollowUp('2026-10-08');
    expect(res.status).toBe(200);
  });

  it('returns 400 DATE_IN_PAST for a date before today in Pakistan time, and saves nothing', async () => {
    const res = await setFollowUp('2026-10-07');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'DATE_IN_PAST', message: 'The follow-up date cannot be in the past.' } });
    expect(ctx.consultations[0].followUpDate).toBeNull();
    expect(followUpMessages()).toHaveLength(0);
  });

  it('returns 404 CONSULTATION_NOT_FOUND for another doctor’s consultation, and changes nothing', async () => {
    const res = await setFollowUp('2026-10-21', { doctorId: OTHER_DOCTOR_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
    expect(ctx.consultations[0].followUpDate).toBeNull();
    expect(followUpMessages()).toHaveLength(0);
  });

  it('returns 404 CONSULTATION_NOT_FOUND for a consultation that does not exist', async () => {
    const res = await setFollowUp('2026-10-21', { consultationId: 99 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
  });

  it.each([
    ['no followUpDate', {}],
    ['a date in another format', { followUpDate: '21/10/2026' }],
    ['a date that does not exist', { followUpDate: '2026-02-30' }],
    ['a date with a time', { followUpDate: '2026-10-21T09:00:00Z' }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_, body) => {
    const res = await ctx.as().put('/consultations/1/follow-up').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an error when followup.changed cannot be sent, so the app can save again', async () => {
    ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));
    const res = await setFollowUp('2026-10-21');
    expect(res.status).toBe(500);
  });

  it('returns 401 without the gateway user headers', async () => {
    const res = await request(ctx.app).put('/consultations/1/follow-up').send({ followUpDate: '2026-10-21' });
    expect(res.status).toBe(401);
  });
});
