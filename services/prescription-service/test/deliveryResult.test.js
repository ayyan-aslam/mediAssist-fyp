import { beforeEach, describe, expect, it } from 'vitest';
import { RequestValidator } from '../src/validators/RequestValidator.js';
import { createTestContext } from './helpers.js';

// delivery.result (design doc 6.4.8): read from prescription.delivery.result, Diagram 9.
describe('delivery.result', () => {
  let ctx;
  let messageId;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.finalize();
    await ctx.as().post('/prescriptions/1/send').send({ channel: 'email' });
    messageId = ctx.sends[0].messageId;
  });

  // What the queue handler in server.js does with the message data.
  const handle = async (data) =>
    ctx.prescriptionService.saveDeliveryResult(new RequestValidator().validateDeliveryResult(data));

  const result = (changes = {}) => ({
    prescriptionId: 1,
    doctorId: 16,
    requestMessageId: messageId,
    channel: 'email',
    status: 'sent',
    errorMessage: null,
    attemptedAt: '2026-10-07T09:41:05Z',
    ...changes,
  });

  it('marks the send as sent, and the delivery list shows it', async () => {
    await handle(result());

    expect(ctx.sends[0]).toMatchObject({ status: 'sent', errorMessage: null, completedAt: expect.any(Date) });
    const res = await ctx.as().get('/prescriptions/1/deliveries');
    expect(res.body.items[0]).toMatchObject({ status: 'sent', completedAt: expect.any(String) });
  });

  it('marks the send as failed with the reason', async () => {
    await handle(result({ status: 'failed', errorMessage: 'Mailbox not found' }));
    expect(ctx.sends[0]).toMatchObject({ status: 'failed', errorMessage: 'Mailbox not found' });
  });

  it('is safe to run twice: the same message again changes nothing', async () => {
    await handle(result());
    const { completedAt } = ctx.sends[0];

    await handle(result());
    await handle(result({ status: 'failed', errorMessage: 'late duplicate' }));
    expect(ctx.sends[0]).toMatchObject({ status: 'sent', errorMessage: null, completedAt });
  });

  it('skips a result for an unknown request or another prescription', async () => {
    await handle(result({ requestMessageId: '00000000-0000-4000-8000-000000000000' }));
    await handle(result({ prescriptionId: 2 }));
    expect(ctx.sends[0].status).toBe('sending');
  });

  it('rejects a message with a wrong status, so it goes to the retry and dead-letter queues', async () => {
    await expect(handle(result({ status: 'delivered' }))).rejects.toThrow('status');
    expect(ctx.sends[0].status).toBe('sending');
  });
});
