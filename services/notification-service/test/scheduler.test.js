import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, followUpChanged, smtpError } from './helpers.js';

// The reminder job (design doc Diagram 10, Part 3).
describe('ReminderScheduler', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext({ now: new Date('2026-10-07T09:45:00Z') });
    // Two reminders on 20 October 04:00 UTC, one doctor reminder on 24 October.
    await ctx.reminderService.handleFollowUpChanged(followUpChanged());
    await ctx.reminderService.handleFollowUpChanged(
      followUpChanged({ consultationId: 42, followUpDate: '2026-10-25', patientEmail: null }),
    );
  });

  it('sends nothing before the time has come', async () => {
    expect(await ctx.reminderScheduler.sendDue()).toEqual({ sent: 0, failed: 0 });
    expect(ctx.emailSender.send).not.toHaveBeenCalled();
  });

  it('sends the due reminders and marks them sent', async () => {
    ctx.setNow(new Date('2026-10-20T04:00:00Z'));
    expect(await ctx.reminderScheduler.sendDue()).toEqual({ sent: 2, failed: 0 });

    const emails = ctx.emailSender.send.mock.calls.map(([email]) => email);
    expect(emails.map((e) => e.to)).toEqual(['sara@example.com', 'bilal@example.com']);
    expect(emails[0].subject).toBe('Follow-up reminder: Bilal Hussain on Wednesday, 21 October 2026');
    expect(emails[1].subject).toBe('Reminder: your follow-up visit with Dr. Sara Ahmed');
    expect(emails[1].text).toContain('Wednesday, 21 October 2026');
    expect(ctx.reminders.filter((r) => r.consultationId === 41)).toEqual([
      expect.objectContaining({ status: 'sent', sentAt: expect.any(Date) }),
      expect.objectContaining({ status: 'sent', sentAt: expect.any(Date) }),
    ]);
    expect(ctx.reminders.find((r) => r.consultationId === 42).status).toBe('pending');
  });

  it('marks a reminder failed when the email fails, and goes on with the next one', async () => {
    ctx.setNow(new Date('2026-10-20T04:00:00Z'));
    ctx.emailSender.send.mockRejectedValueOnce(smtpError('Connection timeout', { code: 'ETIMEDOUT' }));

    expect(await ctx.reminderScheduler.sendDue()).toEqual({ sent: 1, failed: 1 });
    expect(ctx.reminders.slice(0, 2).map((r) => [r.status, r.sentAt])).toEqual([
      ['failed', null],
      ['sent', expect.any(Date)],
    ]);
  });

  it('claims each reminder once: a second run sends nothing again', async () => {
    ctx.setNow(new Date('2026-10-20T04:00:00Z'));
    const [first, second] = await Promise.all([ctx.reminderScheduler.sendDue(), ctx.reminderScheduler.sendDue()]);
    expect(first.sent + second.sent).toBe(2);
    expect(await ctx.reminderScheduler.sendDue()).toEqual({ sent: 0, failed: 0 });
    expect(ctx.emailSender.send).toHaveBeenCalledTimes(2);
  });

  it('sends every pending reminder with all: true (scripts/send-due-reminders.js --all), in batches', async () => {
    expect(await ctx.reminderScheduler.sendDue({ all: true })).toEqual({ sent: 3, failed: 0 });
    // Batch size 2 in the tests: one full batch, then one more claim.
    expect(ctx.reminderRepository.claimDue).toHaveBeenCalledTimes(2);
    expect(ctx.reminders.every((r) => r.status === 'sent')).toBe(true);
  });
});
