import { beforeEach, describe, expect, it } from 'vitest';
import { MessageValidator } from '../src/validators/MessageValidator.js';
import { createTestContext, MESSAGE_ID, PDF, prescriptionSend, smtpError } from './helpers.js';

// prescription.send -> email with the PDF -> PRESCRIPTION_DELIVERY -> delivery.result (design doc Diagram 9).
describe('prescription.send', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  // What the queue handler in server.js does with the message.
  const handle = async (data = prescriptionSend(), messageId = MESSAGE_ID) =>
    ctx.deliveryService.handlePrescriptionSend(messageId, new MessageValidator().validatePrescriptionSend(data));

  const results = () => ctx.eventPublisher.publish.mock.calls.filter(([type]) => type === 'delivery.result');

  it('emails the patient with the PDF from S3 attached', async () => {
    await handle();

    expect(ctx.s3Client.getBuffer).toHaveBeenCalledWith('prescriptions/33.pdf');
    expect(ctx.emailSender.send).toHaveBeenCalledTimes(1);
    const email = ctx.emailSender.send.mock.calls[0][0];
    expect(email).toMatchObject({
      to: 'bilal@example.com',
      subject: 'Your prescription from Dr. Sara Ahmed',
      attachments: [{ filename: 'prescription-33.pdf', content: PDF, contentType: 'application/pdf' }],
    });
    expect(email.text).toContain('Dear Bilal Hussain,');
    expect(email.html).toContain('<p>Dear Bilal Hussain,</p>');
  });

  it('adds "Dr" to a doctor name without it, and escapes names in the HTML', async () => {
    await handle(prescriptionSend({ doctorName: 'Sara Ahmed', patientName: 'Ali <b>Raza</b>' }));
    const email = ctx.emailSender.send.mock.calls[0][0];
    expect(email.subject).toBe('Your prescription from Dr Sara Ahmed');
    expect(email.html).toContain('Ali &lt;b&gt;Raza&lt;/b&gt;');
  });

  it('saves the result and publishes delivery.result with requestMessageId = the incoming messageId', async () => {
    await handle();

    expect(ctx.deliveries).toEqual([
      expect.objectContaining({
        messageId: MESSAGE_ID,
        prescriptionId: 33,
        channel: 'email',
        recipient: 'bilal@example.com',
        status: 'sent',
        errorMessage: null,
        attemptedAt: expect.any(Date),
      }),
    ]);
    expect(results()).toEqual([
      [
        'delivery.result',
        {
          prescriptionId: 33,
          doctorId: 16,
          requestMessageId: MESSAGE_ID,
          channel: 'email',
          status: 'sent',
          errorMessage: null,
          attemptedAt: ctx.deliveries[0].attemptedAt.toISOString(),
        },
      ],
    ]);
  });

  it('skips a duplicate: the email is not sent again, and the saved result is sent again', async () => {
    await handle();
    await handle();

    expect(ctx.emailSender.send).toHaveBeenCalledTimes(1);
    expect(ctx.s3Client.getBuffer).toHaveBeenCalledTimes(1);
    expect(ctx.deliveries).toHaveLength(1);
    expect(results()).toHaveLength(2);
    expect(results()[1][1]).toEqual(results()[0][1]);
  });

  it('tries 3 times, then saves failed and publishes it', async () => {
    ctx.emailSender.send.mockRejectedValue(smtpError('Connection timeout', { code: 'ETIMEDOUT' }));
    await handle();

    expect(ctx.emailSender.send).toHaveBeenCalledTimes(3);
    expect(ctx.deliveries[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'The email could not be sent. Please try again later.',
    });
    expect(results()[0][1]).toMatchObject({
      status: 'failed',
      errorMessage: 'The email could not be sent. Please try again later.',
      requestMessageId: MESSAGE_ID,
    });
  });

  it('is sent when a later try works', async () => {
    ctx.emailSender.send
      .mockRejectedValueOnce(smtpError('Connection closed', { code: 'ECONNECTION' }))
      .mockRejectedValueOnce(smtpError('421 Service not available, try again later', { responseCode: 421 }));
    await handle();
    expect(ctx.emailSender.send).toHaveBeenCalledTimes(3);
    expect(ctx.deliveries[0].status).toBe('sent');
  });

  it('does not retry an address the mail server refuses', async () => {
    ctx.emailSender.send.mockRejectedValue(
      smtpError('Can\'t send mail - all recipients were rejected: 550 5.1.1 No such user', {
        code: 'EENVELOPE',
        responseCode: 550,
      }),
    );
    await handle();

    expect(ctx.emailSender.send).toHaveBeenCalledTimes(1);
    expect(ctx.deliveries[0]).toMatchObject({
      status: 'failed',
      errorMessage: "The patient's email address was rejected by the mail server.",
    });
  });

  it('tries a failed SMTP login 3 times, then saves failed with the login reason', async () => {
    ctx.emailSender.send.mockRejectedValue(smtpError('Invalid login: 535 5.7.8', { code: 'EAUTH', responseCode: 535 }));
    await handle();
    expect(ctx.emailSender.send).toHaveBeenCalledTimes(3);
    expect(ctx.deliveries[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'The email could not be sent: the clinic email account could not log in. Please tell the administrator.',
    });
  });

  it('does not try an address that is not an email address', async () => {
    await handle(prescriptionSend({ recipient: 'not-an-email' }));

    expect(ctx.emailSender.send).not.toHaveBeenCalled();
    expect(ctx.deliveries[0]).toMatchObject({ status: 'failed', errorMessage: "The patient's email address is not valid." });
    expect(results()[0][1].status).toBe('failed');
  });

  it('lets the queue retry when the PDF cannot be read, then saves failed from the dead-letter queue', async () => {
    ctx.files.clear();
    await expect(handle()).rejects.toThrow('does not exist');
    expect(ctx.deliveries).toHaveLength(0);
    expect(results()).toHaveLength(0);

    await ctx.deliveryService.handleDeadLetter(MESSAGE_ID, prescriptionSend());
    expect(ctx.deliveries[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'The prescription PDF could not be read. Please try again.',
    });
    expect(results()[0][1]).toMatchObject({ status: 'failed', requestMessageId: MESSAGE_ID });

    // A dead letter for a request that was already saved changes nothing.
    await ctx.deliveryService.handleDeadLetter(MESSAGE_ID, prescriptionSend());
    expect(ctx.deliveries).toHaveLength(1);
  });

  it('rejects a message that does not match 6.4.7 (for example WhatsApp), so it goes to the dead-letter queue', async () => {
    await expect(handle(prescriptionSend({ channel: 'whatsapp' }))).rejects.toThrow('channel');
    await expect(handle(prescriptionSend({ pdfKey: undefined }))).rejects.toThrow('pdfKey');
    expect(ctx.emailSender.send).not.toHaveBeenCalled();
  });
});
