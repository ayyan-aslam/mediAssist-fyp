import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

const AUDIO = Buffer.from('fake webm audio');

describe('stop and retry', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.as().post('/clinical-patients').send(validPatient);
    await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
  });

  const upload = (partNo) =>
    ctx
      .as()
      .post('/consultations/1/audio-parts')
      .field('partNo', String(partNo))
      .field('durationSec', '10')
      .attach('audio', AUDIO, { filename: `${partNo}.webm`, contentType: 'audio/webm' });

  const uploadAll = async (count) => {
    for (let partNo = 1; partNo <= count; partNo += 1) {
      expect((await upload(partNo)).status).toBe(201);
    }
  };

  const stop = (totalParts, { consultationId = 1, doctorId } = {}) =>
    ctx.as(doctorId).post(`/consultations/${consultationId}/stop`).send({ totalParts });

  const recordedMessages = () =>
    ctx.eventPublisher.publish.mock.calls.filter(([type]) => type === 'consultation.recorded').map(([, data]) => data);

  describe('POST /consultations/{consultationId}/stop', () => {
    it('returns 409 PARTS_MISSING with the missing parts and keeps recording', async () => {
      await upload(1);
      await upload(2);
      await upload(4);

      const res = await stop(6);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'PARTS_MISSING', message: 'Some audio parts did not arrive.', missingParts: [3, 5, 6] },
      });
      expect(ctx.consultations[0].status).toBe('recording');
      expect(recordedMessages()).toEqual([]);
    });

    it('sets processing and ended_at, and sends consultation.recorded', async () => {
      await uploadAll(8);

      const res = await stop(8);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ consultationId: 1, status: 'processing', endedAt: expect.any(String) });
      expect(ctx.consultations[0]).toMatchObject({ status: 'processing', endedAt: new Date(res.body.endedAt) });
      expect(recordedMessages()).toEqual([
        { consultationId: 1, totalParts: 8, lastFullWindowNo: 1, endedAt: res.body.endedAt },
      ]);
    });

    it('returns 409 NOT_RECORDING when it is already stopped', async () => {
      await uploadAll(2);
      expect((await stop(2)).status).toBe(200);

      const res = await stop(2);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_RECORDING');
      expect(recordedMessages()).toHaveLength(1);
    });

    it("returns 404 for another doctor's consultation", async () => {
      await uploadAll(1);
      const res = await stop(1, { doctorId: OTHER_DOCTOR_ID });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
      expect(ctx.consultations[0].status).toBe('recording');
    });

    it('returns 404 for an unknown consultation', async () => {
      expect((await stop(1, { consultationId: 99 })).status).toBe(404);
    });

    it.each([[0], [181], ['6'], [null]])('returns 400 VALIDATION_ERROR for totalParts %j', async (totalParts) => {
      const res = await stop(totalParts);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('goes back to recording when consultation.recorded cannot be sent', async () => {
      await uploadAll(1);
      ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));

      const res = await stop(1);

      expect(res.status).toBe(500);
      expect(ctx.consultations[0]).toMatchObject({ status: 'recording', endedAt: null });
      expect((await stop(1)).status).toBe(200);
    });
  });

  describe('POST /consultations/{consultationId}/retry', () => {
    const retry = (doctorId) => ctx.as(doctorId).post('/consultations/1/retry');

    it('returns 409 NOT_FAILED when the consultation has not failed', async () => {
      const res = await retry();
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_FAILED');
    });

    it('starts the next attempt and sends consultation.recorded again', async () => {
      await uploadAll(7);
      await stop(7);
      Object.assign(ctx.consultations[0], {
        status: 'failed',
        failureReason: 'AI_TIMEOUT',
        aiRequestedAt: new Date(),
      });
      const endedAt = ctx.consultations[0].endedAt.toISOString();

      const res = await retry();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ consultationId: 1, status: 'processing' });
      expect(ctx.consultations[0]).toMatchObject({
        status: 'processing',
        soapAttempt: 2,
        failureReason: null,
        aiRequestedAt: null,
      });
      expect(recordedMessages().at(-1)).toEqual({ consultationId: 1, totalParts: 7, lastFullWindowNo: 1, endedAt });
    });

    it("returns 404 for another doctor's consultation", async () => {
      Object.assign(ctx.consultations[0], { status: 'failed', failureReason: 'AI_FAILED' });
      const res = await retry(OTHER_DOCTOR_ID);
      expect(res.status).toBe(404);
      expect(ctx.consultations[0].soapAttempt).toBe(1);
    });

    it('goes back to failed when consultation.recorded cannot be sent', async () => {
      Object.assign(ctx.consultations[0], { status: 'failed', failureReason: 'AI_FAILED', endedAt: new Date() });
      ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));

      expect((await retry()).status).toBe(500);
      expect(ctx.consultations[0]).toMatchObject({ status: 'failed', failureReason: 'AI_FAILED' });
    });
  });
});
