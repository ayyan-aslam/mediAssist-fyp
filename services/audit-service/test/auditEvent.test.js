import { describe, expect, it } from 'vitest';
import { auditEvent, createTestContext } from './helpers.js';

describe('audit.event consumer', () => {
  it('reads the audit.audit.event queue', () => {
    const { auditEventConsumer, eventConsumer } = createTestContext();
    auditEventConsumer.start();
    expect(eventConsumer.consume).toHaveBeenCalledWith('audit.audit.event', auditEventConsumer.handle);
  });

  it('saves the event with the messageId, and occurredAt as the time', async () => {
    const { auditEventConsumer, auditRepository } = createTestContext();
    const message = auditEvent();
    await auditEventConsumer.handle(message);
    expect(auditRepository.rows).toEqual([
      {
        logId: 1n,
        messageId: message.messageId,
        userId: 16,
        action: 'prescription_send',
        details: 'Prescription 33 sent by email',
        ipAddress: '39.45.12.8',
        createdAt: new Date('2026-10-07T09:41:00Z'),
      },
    ]);
  });

  it('is safe to run twice: the same messageId is saved once', async () => {
    const { auditEventConsumer, auditRepository } = createTestContext();
    const message = auditEvent();
    await auditEventConsumer.handle(message);
    await auditEventConsumer.handle(message);
    expect(auditRepository.rows).toHaveLength(1);
  });

  it('saves every action, with details null when it is missing or empty', async () => {
    const { auditEventConsumer, auditRepository } = createTestContext();
    const actions = ['login', 'logout', 'document_upload', 'soap_note_change', 'prescription_send', 'account_suspension'];
    for (const action of actions) {
      await auditEventConsumer.handle(auditEvent({}, { action, details: action === 'login' ? null : '' }));
    }
    await auditEventConsumer.handle(auditEvent({}, { details: undefined }));
    expect(auditRepository.rows.map((row) => row.action)).toEqual([...actions, 'prescription_send']);
    expect(auditRepository.rows.every((row) => row.details === null)).toBe(true);
  });

  it('cuts details to 255 characters and keeps Urdu text', async () => {
    const { auditEventConsumer, auditRepository } = createTestContext();
    await auditEventConsumer.handle(auditEvent({}, { details: 'ب'.repeat(300) }));
    expect(auditRepository.rows[0].details).toBe('ب'.repeat(255));
  });

  it.each([
    ['an unknown action', {}, { action: 'login_failed' }],
    ['no IP address', {}, { ipAddress: '' }],
    ['a bad time', {}, { occurredAt: 'yesterday' }],
    ['no user', {}, { userId: null }],
    ['a messageId that is not a UUID', { messageId: 'abc' }, {}],
  ])('throws for %s, so the message goes to the retry and dead-letter queues', async (_, changes, dataChanges) => {
    const { auditEventConsumer, auditRepository } = createTestContext();
    await expect(auditEventConsumer.handle(auditEvent(changes, dataChanges))).rejects.toThrow('Invalid message');
    expect(auditRepository.rows).toHaveLength(0);
  });
});
