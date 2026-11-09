import nodemailer from 'nodemailer';

// Sends email over SMTP (Gmail) with nodemailer. Kept small, so tests can replace it.
// It is the MessageSender of design doc Diagram 10 and the EmailSender of Diagram 9.
export class EmailSender {
  constructor({ host, port, secure, user, pass, from }) {
    this.from = from;
    this.transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  }

  // Logs in to the SMTP server once. Throws when the server or the login does not work.
  async verify() {
    await this.transporter.verify();
  }

  // attachments: [{ filename, content (Buffer), contentType }]. Text and HTML are sent as UTF-8.
  async send({ to, subject, text, html, attachments = [] }) {
    await this.transporter.sendMail({ from: this.from, to, subject, text, html, attachments });
  }
}

// The SMTP server refused our login (wrong SMTP_USER or SMTP_PASS, or Gmail blocked it for a while).
export function isLoginError(err) {
  return ['EAUTH', 'ENOAUTH'].includes(err.code);
}

// Errors that will fail the same way on every try: the server refused the address or the message.
// Network errors, 4xx answers (for example 421 or 450, try later) and login errors (Gmail can refuse a
// login for a short time) are worth another try.
export function isPermanentEmailError(err) {
  if (isLoginError(err)) return false;
  if (err.code === 'EENVELOPE') return true;
  return err.responseCode >= 500 && err.responseCode < 600;
}

// The server refused the recipient address (for example 550 mailbox not found).
export function isRejectedAddressError(err) {
  return err.code === 'EENVELOPE' || [550, 551, 553].includes(err.responseCode);
}
