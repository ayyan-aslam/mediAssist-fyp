import { reminderEmail } from './emails.js';

// Every minute, sends the follow-up reminders that are due and marks each one sent or failed
// (design doc Diagram 10, Part 3). Safe with more than one instance: each reminder is claimed once.
export class ReminderScheduler {
  #timer = null;
  #running = false;

  constructor({ reminderRepository, emailSender, logger, intervalMs = 60_000, batchSize = 50 }) {
    this.reminderRepository = reminderRepository;
    this.emailSender = emailSender;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
  }

  start() {
    this.#timer = setInterval(() => this.#tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.#timer);
  }

  // all: true sends every pending reminder now, also those not due yet (scripts/send-due-reminders.js).
  // Returns how many were sent and how many failed.
  async sendDue({ all = false } = {}) {
    let sent = 0;
    let failed = 0;
    for (;;) {
      const reminders = await this.reminderRepository.claimDue({ all, limit: this.batchSize });
      for (const reminder of reminders) {
        if (await this.#send(reminder)) sent++;
        else failed++;
      }
      if (reminders.length < this.batchSize) return { sent, failed };
    }
  }

  async #send(reminder) {
    const log = { reminderId: reminder.reminderId, consultationId: reminder.consultationId };
    try {
      await this.emailSender.send({ to: reminder.recipientEmail, ...reminderEmail(reminder) });
    } catch (err) {
      this.logger.warn({ ...log, err }, 'Follow-up reminder failed');
      await this.reminderRepository.markFailed(reminder.reminderId);
      return false;
    }
    await this.reminderRepository.markSent(reminder.reminderId, new Date());
    this.logger.info(log, 'Follow-up reminder sent');
    return true;
  }

  // A run that is still busy is not started twice in the same instance.
  async #tick() {
    if (this.#running) return;
    this.#running = true;
    try {
      await this.sendDue();
    } catch (err) {
      this.logger.error({ err }, 'Reminder job failed');
    } finally {
      this.#running = false;
    }
  }
}
