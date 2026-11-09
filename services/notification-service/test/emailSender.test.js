import { beforeEach, describe, expect, it, vi } from 'vitest';

// nodemailer is mocked: tests never connect to an SMTP server or send real emails.
const transporter = vi.hoisted(() => ({ verify: vi.fn(), sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => transporter) } }));

const nodemailer = (await import('nodemailer')).default;
const { EmailSender, isPermanentEmailError, isRejectedAddressError } = await import('../src/clients/EmailSender.js');

describe('EmailSender', () => {
  const options = {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: 'clinic@gmail.com',
    pass: 'app-password',
    from: 'MediAssist AI <clinic@gmail.com>',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects to the SMTP server with the login', () => {
    new EmailSender(options);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'clinic@gmail.com', pass: 'app-password' },
    });
  });

  it('sends from SMTP_FROM with text, HTML and attachments', async () => {
    const attachments = [{ filename: 'prescription-33.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }];
    await new EmailSender(options).send({ to: 'ali@example.com', subject: 'S', text: 'T', html: '<p>T</p>', attachments });
    expect(transporter.sendMail).toHaveBeenCalledWith({
      from: 'MediAssist AI <clinic@gmail.com>',
      to: 'ali@example.com',
      subject: 'S',
      text: 'T',
      html: '<p>T</p>',
      attachments,
    });
  });

  it('verify() throws when the SMTP login fails', async () => {
    transporter.verify.mockRejectedValue(new Error('Invalid login'));
    await expect(new EmailSender(options).verify()).rejects.toThrow('Invalid login');
  });
});

describe('email errors', () => {
  const err = (fields) => Object.assign(new Error('x'), fields);

  it('treats refused addresses, failed logins and 5xx answers as permanent', () => {
    expect(isPermanentEmailError(err({ code: 'EENVELOPE' }))).toBe(true);
    expect(isPermanentEmailError(err({ code: 'EAUTH', responseCode: 535 }))).toBe(true);
    expect(isPermanentEmailError(err({ code: 'EMESSAGE', responseCode: 552 }))).toBe(true);
  });

  it('retries network errors and 4xx answers', () => {
    expect(isPermanentEmailError(err({ code: 'ETIMEDOUT' }))).toBe(false);
    expect(isPermanentEmailError(err({ code: 'ECONNECTION' }))).toBe(false);
    expect(isPermanentEmailError(err({ code: 'EMESSAGE', responseCode: 421 }))).toBe(false);
  });

  it('knows a refused address', () => {
    expect(isRejectedAddressError(err({ code: 'EENVELOPE' }))).toBe(true);
    expect(isRejectedAddressError(err({ responseCode: 550 }))).toBe(true);
    expect(isRejectedAddressError(err({ code: 'EAUTH', responseCode: 535 }))).toBe(false);
  });
});
