import { beforeEach, describe, expect, it } from 'vitest';
import { binary, CONSULTATION_ID, createTestContext, DOCTOR_ID, OTHER_DOCTOR_ID } from './helpers.js';

// POST /prescriptions and the reads: design doc 5.7 and Diagram 8.
describe('POST /prescriptions (finalize)', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it('saves a final copy with each line source, uploads the PDF and returns the prescription', async () => {
    const res = await ctx.finalize();

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      prescriptionId: 1,
      consultationId: CONSULTATION_ID,
      status: 'final',
      patientName: 'Ali Raza',
      notes: 'Warm salt water gargles.',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      items: [
        {
          itemId: 1,
          position: 1,
          medicineName: 'Panadol',
          genericName: 'Paracetamol',
          dose: '1 tablet',
          frequency: 'twice a day',
          duration: '3 days',
          instructions: null,
          source: 'doctor_prescribed',
          referenceInfo: { indication: 'Fever and pain' },
        },
        expect.objectContaining({ position: 2, medicineName: 'Act-On', source: 'ai_accepted' }),
        expect.objectContaining({ position: 3, medicineName: 'ORS', source: 'doctor_added', referenceInfo: null }),
      ],
    });
    expect(ctx.consultationClient.getPrescriptionSource).toHaveBeenCalledWith(CONSULTATION_ID, DOCTOR_ID);
    expect(ctx.prescriptions[0]).toMatchObject({ doctorId: DOCTOR_ID, pdfKey: 'prescriptions/1.pdf' });

    // PDF upload (S3 mocked): the key from design doc 4.4.5, a real PDF.
    expect(ctx.s3Client.upload).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = ctx.s3Client.upload.mock.calls[0];
    expect(key).toBe('prescriptions/1.pdf');
    expect(contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns 409 PRESCRIPTION_EXISTS with the prescriptionId when finalized twice', async () => {
    await ctx.finalize();
    const res = await ctx.finalize();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PRESCRIPTION_EXISTS', prescriptionId: 1 });
    expect(ctx.prescriptions).toHaveLength(1);
    expect(ctx.consultationClient.getPrescriptionSource).toHaveBeenCalledTimes(1);
    expect(ctx.s3Client.upload).toHaveBeenCalledTimes(1);
  });

  it('returns 409 PRESCRIPTION_EXISTS when two finalize requests run at the same time', async () => {
    const [first, second] = await Promise.all([ctx.finalize(), ctx.finalize()]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect([first, second].find((r) => r.status === 409).body.error.prescriptionId).toBe(1);
    expect(ctx.prescriptions).toHaveLength(1);
  });

  it('returns 409 PRESCRIPTION_EMPTY and saves nothing when there are no medicines', async () => {
    ctx.consultationClient.sources.get(CONSULTATION_ID).medicines = [];
    const res = await ctx.finalize();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRESCRIPTION_EMPTY');
    expect(ctx.prescriptions).toHaveLength(0);
    expect(ctx.s3Client.upload).not.toHaveBeenCalled();
  });

  it('passes on 409 SOAP_NOT_READY from the Consultation Service', async () => {
    ctx.consultationClient.sources.get(CONSULTATION_ID).soapNotReady = true;
    const res = await ctx.finalize();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SOAP_NOT_READY');
    expect(ctx.prescriptions).toHaveLength(0);
  });

  it("returns 404 CONSULTATION_NOT_FOUND for another doctor's consultation, also after it was finalized", async () => {
    const before = await ctx.finalize(OTHER_DOCTOR_ID);
    expect(before.status).toBe(404);
    expect(before.body.error.code).toBe('CONSULTATION_NOT_FOUND');

    await ctx.finalize();
    const after = await ctx.finalize(OTHER_DOCTOR_ID);
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('CONSULTATION_NOT_FOUND');
    expect(after.body.error.prescriptionId).toBeUndefined();
  });

  it('removes the prescription and returns 503 when the PDF upload fails, so the doctor can try again', async () => {
    ctx.s3Client.upload.mockRejectedValueOnce(new Error('S3 is down'));
    const failed = await ctx.finalize();
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(ctx.prescriptions).toHaveLength(0);

    expect((await ctx.finalize()).status).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR without a valid consultationId', async () => {
    const res = await ctx.as().post('/prescriptions').send({ consultationId: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('reading a prescription', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.finalize();
  });

  it('GET /prescriptions?consultationId= returns it, or 404 PRESCRIPTION_NOT_FOUND before finalize', async () => {
    const res = await ctx.as().get(`/prescriptions?consultationId=${CONSULTATION_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.prescriptionId).toBe(1);

    const missing = await ctx.as().get('/prescriptions?consultationId=99');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PRESCRIPTION_NOT_FOUND');

    const invalid = await ctx.as().get('/prescriptions');
    expect(invalid.status).toBe(400);
  });

  it('GET /prescriptions/{id} returns the prescription object', async () => {
    const res = await ctx.as().get('/prescriptions/1');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body).not.toHaveProperty('pdfKey');
    expect(res.body).not.toHaveProperty('doctorId');
    expect((await ctx.as().get('/prescriptions/abc')).status).toBe(404);
  });

  it('GET /prescriptions/{id}/pdf streams the PDF from S3', async () => {
    const res = await ctx.as().get('/prescriptions/1/pdf').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="prescription-1.pdf"');
    expect(res.body.equals(ctx.s3Client.files.get('prescriptions/1.pdf'))).toBe(true);
    expect(ctx.s3Client.getStream).toHaveBeenCalledWith('prescriptions/1.pdf');
  });

  it('returns 503 when the PDF cannot be read from S3', async () => {
    ctx.s3Client.files.clear();
    const res = await ctx.as().get('/prescriptions/1/pdf');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it("returns 404 PRESCRIPTION_NOT_FOUND for another doctor's prescription on every route", async () => {
    const other = ctx.as(OTHER_DOCTOR_ID);
    const answers = await Promise.all([
      other.get(`/prescriptions?consultationId=${CONSULTATION_ID}`),
      other.get('/prescriptions/1'),
      other.get('/prescriptions/1/pdf'),
      other.get('/prescriptions/1/send-options'),
      other.post('/prescriptions/1/send').send({ channel: 'email' }),
      other.get('/prescriptions/1/deliveries'),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRESCRIPTION_NOT_FOUND');
    }
    expect(ctx.sends).toHaveLength(0);
    expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
  });
});
