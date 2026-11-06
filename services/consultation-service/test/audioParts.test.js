import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

const AUDIO = Buffer.from('fake webm audio');

describe('POST /consultations/{consultationId}/audio-parts', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.as().post('/clinical-patients').send(validPatient);
    await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
  });

  const upload = (partNo, { consultationId = 1, doctorId, durationSec = 10, contentType = 'audio/webm' } = {}) =>
    ctx
      .as(doctorId)
      .post(`/consultations/${consultationId}/audio-parts`)
      .field('partNo', String(partNo))
      .field('durationSec', String(durationSec))
      .attach('audio', AUDIO, { filename: `${partNo}.webm`, contentType });

  const uploadAll = async (partNos) => {
    for (const partNo of partNos) {
      expect((await upload(partNo)).status).toBe(201);
    }
  };

  const windowMessages = () =>
    ctx.eventPublisher.publish.mock.calls.filter(([type]) => type === 'audio.window.ready').map(([, data]) => data);

  it('saves a new part in S3 and the database and returns 201', async () => {
    const res = await upload(7);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ partNo: 7, saved: true });
    expect(ctx.s3Client.upload).toHaveBeenCalledWith('consultations/1/parts/7.webm', AUDIO, 'audio/webm');
    expect(ctx.audioParts).toEqual([
      expect.objectContaining({
        consultationId: 1,
        partNo: 7,
        fileKey: 'consultations/1/parts/7.webm',
        durationSec: 10,
      }),
    ]);
    expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('accepts the browser type audio/webm;codecs=opus', async () => {
    const res = await upload(1, { contentType: 'audio/webm;codecs=opus' });
    expect(res.status).toBe(201);
  });

  it.each([
    [10.02, 10],
    [4.6, 5],
    [0.3, 1],
  ])('saves a duration of %s seconds as %s', async (durationSec, saved) => {
    await upload(1, { durationSec });
    expect(ctx.audioParts[0].durationSec).toBe(saved);
  });

  it('returns 200 with the same body for a part that is already saved and does nothing', async () => {
    await upload(3);
    const res = await upload(3);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ partNo: 3, saved: true });
    expect(ctx.s3Client.upload).toHaveBeenCalledTimes(1);
    expect(ctx.audioParts).toHaveLength(1);
  });

  it('saves the same part only once when it arrives twice at the same time', async () => {
    const results = await Promise.all([upload(2), upload(2)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(ctx.audioParts).toHaveLength(1);
  });

  it('sends audio.window.ready once when all 6 parts of a minute are saved', async () => {
    await uploadAll([1, 2, 3, 4, 5]);
    expect(windowMessages()).toEqual([]);

    await uploadAll([6]);
    expect(windowMessages()).toEqual([{ consultationId: 1, windowNo: 1, firstPartNo: 1, lastPartNo: 6 }]);
    expect(ctx.windows).toEqual([{ consultationId: 1, windowNo: 1, status: 'pending' }]);

    // Sending the last part again does not send the minute again.
    expect((await upload(6)).status).toBe(200);
    expect(windowMessages()).toHaveLength(1);
  });

  it('sends each minute when its parts arrive out of order', async () => {
    await uploadAll([8, 1, 12, 2, 3, 7, 9, 4, 5, 10, 11]);
    expect(windowMessages()).toEqual([{ consultationId: 1, windowNo: 2, firstPartNo: 7, lastPartNo: 12 }]);

    await uploadAll([6]);
    expect(windowMessages()).toEqual([
      { consultationId: 1, windowNo: 2, firstPartNo: 7, lastPartNo: 12 },
      { consultationId: 1, windowNo: 1, firstPartNo: 1, lastPartNo: 6 },
    ]);
  });

  it('sends the minute once when two parts finish it at the same time', async () => {
    await uploadAll([1, 2, 3, 4]);
    const results = await Promise.all([upload(5), upload(6)]);

    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(windowMessages()).toEqual([{ consultationId: 1, windowNo: 1, firstPartNo: 1, lastPartNo: 6 }]);
    expect(ctx.windows).toHaveLength(1);
  });

  it('sends the minute once when both requests see all 6 parts', async () => {
    await uploadAll([1, 2, 3, 4]);
    // Both parts are saved before either request counts the parts of the minute.
    const savePart = ctx.consultationRepository.savePart.bind(ctx.consultationRepository);
    let release;
    const bothSaved = new Promise((resolve) => {
      release = resolve;
    });
    let saved = 0;
    ctx.consultationRepository.savePart = async (part) => {
      const row = await savePart(part);
      if (++saved === 2) release();
      await bothSaved;
      return row;
    };

    await Promise.all([upload(5), upload(6)]);

    expect(windowMessages()).toHaveLength(1);
    expect(ctx.windows).toHaveLength(1);
  });

  it('keeps the part saved but removes the window row when the message cannot be sent', async () => {
    ctx.eventPublisher.publish.mockRejectedValue(new Error('RabbitMQ is not connected.'));
    await uploadAll([1, 2, 3, 4, 5]);
    const res = await upload(6);

    expect(res.status).toBe(201);
    expect(ctx.audioParts).toHaveLength(6);
    expect(ctx.windows).toEqual([]);
  });

  describe('errors', () => {
    it('returns 404 CONSULTATION_NOT_FOUND for another doctor’s consultation and saves nothing', async () => {
      const res = await upload(1, { doctorId: OTHER_DOCTOR_ID });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'CONSULTATION_NOT_FOUND', message: 'This consultation was not found.' },
      });
      expect(ctx.s3Client.upload).not.toHaveBeenCalled();
      expect(ctx.audioParts).toHaveLength(0);
    });

    it.each(['99', 'abc'])('returns 404 CONSULTATION_NOT_FOUND for consultation %s', async (id) => {
      const res = await upload(1, { consultationId: id });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
    });

    it('returns 409 NOT_RECORDING when the recording has stopped', async () => {
      ctx.consultations[0].status = 'processing';
      const res = await upload(1);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'NOT_RECORDING', message: 'This consultation is not recording any more.' },
      });
      expect(ctx.s3Client.upload).not.toHaveBeenCalled();
    });

    it('returns 200 for a part that was saved before the recording stopped', async () => {
      await upload(1);
      ctx.consultations[0].status = 'processing';

      expect((await upload(1)).status).toBe(200);
    });

    it('accepts part 180 and returns 409 RECORDING_TOO_LONG for part 181', async () => {
      expect((await upload(180)).status).toBe(201);

      const res = await upload(181);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'RECORDING_TOO_LONG', message: 'A recording can be up to 30 minutes long.' },
      });
      expect(ctx.audioParts).toHaveLength(1);
    });

    it('returns 400 FILE_TYPE_NOT_SUPPORTED for audio that is not WebM', async () => {
      const res = await upload(1, { contentType: 'audio/mpeg' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TYPE_NOT_SUPPORTED');
      expect(ctx.audioParts).toHaveLength(0);
    });

    it('returns 400 FILE_TOO_LARGE for a part over 2 MB', async () => {
      const res = await ctx
        .as()
        .post('/consultations/1/audio-parts')
        .field('partNo', '1')
        .field('durationSec', '10')
        .attach('audio', Buffer.alloc(2 * 1024 * 1024 + 1), { filename: '1.webm', contentType: 'audio/webm' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('returns 400 VALIDATION_ERROR without the audio file', async () => {
      const res = await ctx
        .as()
        .post('/consultations/1/audio-parts')
        .field('partNo', '1')
        .field('durationSec', '10');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: { code: 'VALIDATION_ERROR', message: 'audio: the audio file is missing' },
      });
    });

    it.each([
      ['no partNo', { durationSec: '10' }],
      ['partNo 0', { partNo: '0', durationSec: '10' }],
      ['a text partNo', { partNo: 'abc', durationSec: '10' }],
      ['partNo 1.5', { partNo: '1.5', durationSec: '10' }],
      ['no durationSec', { partNo: '1' }],
      ['durationSec 0', { partNo: '1', durationSec: '0' }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, fields) => {
      let req = ctx.as().post('/consultations/1/audio-parts');
      for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
      const res = await req.attach('audio', AUDIO, { filename: '1.webm', contentType: 'audio/webm' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR for a file in another field', async () => {
      const res = await ctx
        .as()
        .post('/consultations/1/audio-parts')
        .field('partNo', '1')
        .field('durationSec', '10')
        .attach('file', AUDIO, { filename: '1.webm', contentType: 'audio/webm' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
