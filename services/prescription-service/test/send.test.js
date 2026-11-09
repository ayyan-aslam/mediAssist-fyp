import { beforeEach, describe, expect, it } from 'vitest';
import { maskEmail } from '../src/services/PrescriptionService.js';
import { CONSULTATION_ID, createTestContext, DOCTOR_ID, DOCTOR_IP, DOCTOR_NAME } from './helpers.js';

// Send options, sending and the delivery list: design doc 5.7, 6.4.7, 6.4.12 and Diagram 9.
describe('sending a prescription', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.finalize();
  });

  const patient = () => ctx.consultationClient.sources.get(CONSULTATION_ID).patient;
  const send = (channel = 'email') => ctx.as().post('/prescriptions/1/send').send({ channel });

  it('masks email addresses', () => {
    expect(maskEmail('ali@example.com')).toBe('al***@example.com');
    expect(maskEmail('ab@example.com')).toBe('a***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('GET send-options: email with a masked address, WhatsApp coming later', async () => {
    const res = await ctx.as().get('/prescriptions/1/send-options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: { available: true, recipient: 'al***@example.com' },
      whatsapp: { available: false, reason: 'Coming later' },
    });
    expect(ctx.consultationClient.getPatientContact).toHaveBeenCalledWith(CONSULTATION_ID);
  });

  it('GET send-options: email not available when the patient has no email', async () => {
    patient().email = null;
    const res = await ctx.as().get('/prescriptions/1/send-options');
    expect(res.body.email).toEqual({ available: false, recipient: null });
  });

  it('returns 409 NO_EMAIL and records nothing when the patient has no email', async () => {
    patient().email = null;
    const res = await send();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_EMAIL');
    expect(ctx.sends).toHaveLength(0);
    expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('refuses WhatsApp and any other channel with 400 CHANNEL_NOT_AVAILABLE', async () => {
    for (const channel of ['whatsapp', 'sms']) {
      const res = await send(channel);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHANNEL_NOT_AVAILABLE');
    }
    expect((await ctx.as().post('/prescriptions/1/send').send({})).body.error.code).toBe('VALIDATION_ERROR');
    expect(ctx.sends).toHaveLength(0);
    expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('records the send, publishes prescription.send with its messageId and the audit event, returns 202', async () => {
    const res = await send();

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sendId: 1, status: 'sending' });

    const [row] = ctx.sends;
    expect(row).toMatchObject({
      prescriptionId: 1,
      messageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      channel: 'email',
      recipient: 'ali@example.com',
      status: 'sending',
    });

    expect(ctx.eventPublisher.publish).toHaveBeenCalledTimes(2);
    expect(ctx.eventPublisher.publish).toHaveBeenNthCalledWith(
      1,
      'prescription.send',
      {
        prescriptionId: 1,
        consultationId: CONSULTATION_ID,
        doctorId: DOCTOR_ID,
        channel: 'email',
        recipient: 'ali@example.com',
        patientName: 'Ali Raza',
        doctorName: DOCTOR_NAME,
        pdfKey: 'prescriptions/1.pdf',
      },
      { messageId: row.messageId },
    );
    expect(ctx.eventPublisher.publish).toHaveBeenNthCalledWith(2, 'audit.event', {
      userId: DOCTOR_ID,
      action: 'prescription_send',
      details: 'Prescription 1 sent by email',
      ipAddress: DOCTOR_IP,
      occurredAt: row.requestedAt.toISOString(),
    });
  });

  it('uses the email the patient has now, not an old copy', async () => {
    patient().email = 'ali.new@example.com';
    await send();
    expect(ctx.sends[0].recipient).toBe('ali.new@example.com');
  });

  it('marks the send failed and returns 503 when RabbitMQ does not take the message', async () => {
    ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));
    const res = await send();
    expect(res.status).toBe(503);
    expect(ctx.sends[0]).toMatchObject({ status: 'failed', completedAt: expect.any(Date) });
    expect(ctx.eventPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it('still returns 202 when only the audit event fails', async () => {
    ctx.eventPublisher.publish.mockImplementation(async (type) => {
      if (type === 'audit.event') throw new Error('RabbitMQ is not connected.');
    });
    const res = await send();
    expect(res.status).toBe(202);
    expect(ctx.sends[0].status).toBe('sending');
  });

  it('GET deliveries: newest first, recipient masked, with paging', async () => {
    await send();
    await send();
    // Make the second one newer for sure.
    ctx.sends[1].requestedAt = new Date(ctx.sends[0].requestedAt.getTime() + 1000);

    const res = await ctx.as().get('/prescriptions/1/deliveries');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          sendId: 2,
          channel: 'email',
          recipient: 'al***@example.com',
          status: 'sending',
          errorMessage: null,
          requestedAt: ctx.sends[1].requestedAt.toISOString(),
          completedAt: null,
        },
        expect.objectContaining({ sendId: 1 }),
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
  });
});
