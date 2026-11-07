import { createLogger } from '@mediassist/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_SESSION_IDLE_MS, EditSessionChecker } from '../src/services/EditSessionChecker.js';
import { EditSessionStore } from '../src/services/EditSessionStore.js';

const MINUTE = 60_000;
const at = (minutes) => new Date(Date.UTC(2026, 9, 7, 9, minutes));

describe('EditSessionStore', () => {
  it('keeps the running session and its changes when the note is opened again', () => {
    const store = new EditSessionStore();
    store.startSession(41, 16, '1.1.1.1', at(0));
    store.markChanged(41, 16, '1.1.1.1', at(1));
    store.startSession(41, 16, '2.2.2.2', at(2));

    expect(store.sessions.get(41)).toEqual({
      consultationId: 41,
      doctorId: 16,
      ipAddress: '1.1.1.1',
      lastActiveAt: at(1),
      changed: true,
    });
  });

  it('starts a changed session on an auto-save without an open session', () => {
    const store = new EditSessionStore();
    store.markChanged(41, 16, '1.1.1.1', at(3));
    expect(store.sessions.get(41)).toMatchObject({ changed: true, lastActiveAt: at(3) });
  });

  it('ends a session only once', () => {
    const store = new EditSessionStore();
    store.startSession(41, 16, '1.1.1.1');

    expect(store.endSession(41)).toMatchObject({ consultationId: 41 });
    expect(store.endSession(41)).toBeNull();
  });

  it('finds the sessions with no activity for the idle time', () => {
    const store = new EditSessionStore();
    store.startSession(1, 16, 'ip', at(0));
    store.markChanged(2, 16, 'ip', at(4));

    expect(store.findIdle(5 * MINUTE, at(6)).map((s) => s.consultationId)).toEqual([1]);
  });
});

describe('EditSessionChecker', () => {
  let store;
  let eventPublisher;
  let checker;

  beforeEach(() => {
    vi.useFakeTimers({ now: at(0) });
    store = new EditSessionStore();
    eventPublisher = { publish: vi.fn(async () => {}) };
    checker = new EditSessionChecker({ editSessionStore: store, eventPublisher, logger: createLogger('test', 'silent') });
    return () => vi.useRealTimers();
  });

  it('waits 5 minutes with no edit before it ends a session', () => {
    expect(EDIT_SESSION_IDLE_MS).toBe(5 * MINUTE);
  });

  it('sends one audit event for an idle changed session and removes it', async () => {
    store.markChanged(41, 16, '39.45.12.8', at(0));
    vi.setSystemTime(at(4));
    await checker.check();
    expect(eventPublisher.publish).not.toHaveBeenCalled();

    vi.setSystemTime(at(5));
    await checker.check();
    await checker.check();

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith('audit.event', {
      userId: 16,
      action: 'soap_note_change',
      details: 'SOAP note of consultation 41 edited',
      ipAddress: '39.45.12.8',
      occurredAt: at(0).toISOString(),
    });
    expect(store.sessions.size).toBe(0);
  });

  it('removes an idle session without changes and sends nothing', async () => {
    store.startSession(41, 16, 'ip', at(0));
    vi.setSystemTime(at(6));

    await checker.check();

    expect(eventPublisher.publish).not.toHaveBeenCalled();
    expect(store.sessions.size).toBe(0);
  });

  it('keeps the session when the event cannot be sent, and sends it on the next check', async () => {
    store.markChanged(41, 16, 'ip', at(0));
    vi.setSystemTime(at(6));
    eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));

    await checker.check();
    expect(store.sessions.get(41).changed).toBe(true);

    await checker.check();
    expect(eventPublisher.publish).toHaveBeenCalledTimes(2);
    expect(store.sessions.size).toBe(0);
  });

  it('ends every session on shutdown (idle time 0)', async () => {
    store.markChanged(1, 16, 'ip', at(0));
    store.markChanged(2, 17, 'ip', at(0));

    await checker.check(0);

    expect(eventPublisher.publish).toHaveBeenCalledTimes(2);
    expect(store.sessions.size).toBe(0);
  });
});
