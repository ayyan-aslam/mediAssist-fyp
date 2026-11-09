import { beforeEach, describe, expect, it } from 'vitest';
import { MessageValidator } from '../src/validators/MessageValidator.js';
import { createTestContext, followUpChanged } from './helpers.js';

// followup.changed -> pending FOLLOW_UP_REMINDER rows (design doc Diagram 10, Part 2, and 6.4.9).
// 9:00 AM in Pakistan (UTC+5) is 04:00 UTC.
describe('followup.changed', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext({ now: new Date('2026-10-07T09:45:00Z') });
  });

  const handle = async (changes = {}) =>
    ctx.reminderService.handleFollowUpChanged(new MessageValidator().validateFollowUpChanged(followUpChanged(changes)));

  const pending = () =>
    ctx.reminders
      .filter((r) => r.status === 'pending')
      .map(({ recipientType, recipientEmail, scheduledAt }) => ({ recipientType, recipientEmail, scheduledAt: scheduledAt.toISOString() }));

  it('creates a doctor and a patient reminder at 9:00 AM Pakistan time one day before', async () => {
    await handle();
    expect(pending()).toEqual([
      { recipientType: 'doctor', recipientEmail: 'sara@example.com', scheduledAt: '2026-10-20T04:00:00.000Z' },
      { recipientType: 'patient', recipientEmail: 'bilal@example.com', scheduledAt: '2026-10-20T04:00:00.000Z' },
    ]);
  });

  it('handles a follow-up on the 1st of the month (reminder on the last day of the month before)', async () => {
    await handle({ followUpDate: '2026-11-01' });
    expect(pending()[0].scheduledAt).toBe('2026-10-31T04:00:00.000Z');
  });

  it('gives the patient no reminder without an email', async () => {
    await handle({ patientEmail: null });
    expect(pending()).toEqual([expect.objectContaining({ recipientType: 'doctor' })]);
  });

  it('updates the pending rows when the date changes, never adds them again', async () => {
    await handle();
    await handle({ followUpDate: '2026-10-25', changedAt: '2026-10-07T10:00:00Z' });

    expect(ctx.reminders).toHaveLength(2);
    expect(pending().map((r) => r.scheduledAt)).toEqual(['2026-10-24T04:00:00.000Z', '2026-10-24T04:00:00.000Z']);
  });

  it('is safe to run twice: the same message again changes nothing', async () => {
    await handle();
    await handle();
    expect(ctx.reminders).toHaveLength(2);
  });

  it('removes the patient reminder when the patient email is removed, and adds it when an email is added', async () => {
    await handle();
    await handle({ patientEmail: null, changedAt: '2026-10-07T10:00:00Z' });
    expect(pending().map((r) => r.recipientType)).toEqual(['doctor']);

    await handle({ patientEmail: 'bilal.new@example.com', changedAt: '2026-10-07T11:00:00Z' });
    expect(pending()).toContainEqual(expect.objectContaining({ recipientType: 'patient', recipientEmail: 'bilal.new@example.com' }));
  });

  it('deletes the pending rows when the date is removed (null); sent rows stay', async () => {
    await handle();
    ctx.reminders[0].status = 'sent';
    await handle({ followUpDate: null, changedAt: '2026-10-07T10:00:00Z' });

    expect(pending()).toEqual([]);
    expect(ctx.reminders).toEqual([expect.objectContaining({ recipientType: 'doctor', status: 'sent' })]);
  });

  it('ignores a message older than the last changedAt of the consultation', async () => {
    await handle({ followUpDate: '2026-10-25', changedAt: '2026-10-07T10:00:00Z' });
    await handle({ followUpDate: '2026-10-21', changedAt: '2026-10-07T09:45:00Z' });
    expect(pending().map((r) => r.scheduledAt)).toEqual(['2026-10-24T04:00:00.000Z', '2026-10-24T04:00:00.000Z']);
  });

  it('ignores an older "set" that arrives after the date was removed', async () => {
    await handle({ followUpDate: null, changedAt: '2026-10-07T10:00:00Z' });
    await handle({ followUpDate: '2026-10-21', changedAt: '2026-10-07T09:45:00Z' });
    expect(ctx.reminders).toEqual([]);
  });

  it('keeps reminders of other consultations apart', async () => {
    await handle();
    await handle({ consultationId: 42, followUpDate: null });
    expect(pending()).toHaveLength(2);
  });

  it('schedules the reminder now when 9:00 AM the day before has already passed', async () => {
    // 10:30 AM in Pakistan on 20 October, follow-up tomorrow.
    const now = new Date('2026-10-20T05:30:00Z');
    ctx.setNow(now);
    await handle({ followUpDate: '2026-10-21', changedAt: now.toISOString() });
    expect(pending().map((r) => r.scheduledAt)).toEqual([now.toISOString(), now.toISOString()]);
  });

  it('rejects a message that does not match 6.4.9', async () => {
    await expect(handle({ followUpDate: '21-10-2026' })).rejects.toThrow('followUpDate');
    await expect(handle({ changedAt: undefined })).rejects.toThrow('changedAt');
    expect(ctx.reminders).toEqual([]);
  });
});
