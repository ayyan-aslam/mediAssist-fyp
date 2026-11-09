import { EventEmitter } from 'node:events';
import amqplib from 'amqplib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventConsumer,
  EventPublisher,
  EXCHANGE,
  QUEUES,
  RabbitConnection,
  setupTopology,
} from '../src/index.js';

vi.mock('amqplib', () => ({ default: { connect: vi.fn() } }));

// A fake amqplib channel. confirm: what the publisher confirm callback gets (null = saved).
function fakeChannel({ confirm = null } = {}) {
  const channel = new EventEmitter();
  Object.assign(channel, {
    assertExchange: vi.fn(async () => {}),
    assertQueue: vi.fn(async () => {}),
    bindQueue: vi.fn(async () => {}),
    prefetch: vi.fn(async () => {}),
    consume: vi.fn(async (queue, onMessage) => {
      channel.onMessage = onMessage;
    }),
    publish: vi.fn((exchange, key, content, options, cb) => {
      setImmediate(() => cb(confirm));
      return true;
    }),
    sendToQueue: vi.fn((queue, content, options, cb) => {
      setImmediate(() => cb(confirm));
      return true;
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn(async () => {}),
  });
  return channel;
}

// A fake amqplib connection (what the recovery setup and the 'connect' event get).
function fakeModel(channel = fakeChannel()) {
  return {
    channel,
    createChannel: vi.fn(async () => channel),
    createConfirmChannel: vi.fn(async () => channel),
  };
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// Starts a RabbitConnection on a fake recovering amqplib connection.
async function startConnection(logger = fakeLogger()) {
  const recovering = new EventEmitter();
  recovering.createConfirmChannel = vi.fn();
  recovering.close = vi.fn(async () => {});
  amqplib.connect.mockResolvedValueOnce(recovering);

  const connection = new RabbitConnection({ url: 'amqp://guest:guest@localhost:5672', logger });
  await connection.start();
  const { setup } = amqplib.connect.mock.calls.at(-1)[1].recovery;

  // Does what amqplib does on every (re)connect: run setup, then emit 'connect'.
  async function connect(model = fakeModel()) {
    await setup(model);
    recovering.emit('connect', model);
    recovering.createConfirmChannel.mockImplementation(model.createConfirmChannel);
    return model;
  }
  return { connection, recovering, connect, logger };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setupTopology', () => {
  it('creates the exchange, every queue with its retry and dead-letter queue, and the bindings', async () => {
    const model = fakeModel();
    await setupTopology(model);
    const { channel } = model;

    expect(channel.assertExchange).toHaveBeenCalledWith('mediassist.events', 'direct', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledTimes(QUEUES.length * 3);
    expect(channel.assertQueue).toHaveBeenCalledWith('notification.followup.changed', {
      durable: true,
      arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'notification.followup.changed.retry' },
    });
    expect(channel.assertQueue).toHaveBeenCalledWith('notification.followup.changed.retry', {
      durable: true,
      arguments: {
        'x-message-ttl': 10000,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'notification.followup.changed',
      },
    });
    expect(channel.assertQueue).toHaveBeenCalledWith('notification.followup.changed.dlq', { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith('gateway.user.status', EXCHANGE, 'user.suspended');
    expect(channel.bindQueue).toHaveBeenCalledWith('gateway.user.status', EXCHANGE, 'user.activated');
    expect(channel.bindQueue).toHaveBeenCalledWith('audit.audit.event', EXCHANGE, 'audit.event');
    expect(channel.close).toHaveBeenCalled();
  });

  it('has the 10 queues of design doc 6.2.2, and each name ends with its first routing key', () => {
    expect(QUEUES).toHaveLength(10);
    // soap.ready was removed (design doc 6.4.6).
    expect(QUEUES.some(({ routingKeys }) => routingKeys.includes('soap.ready'))).toBe(false);
    for (const { name, routingKeys } of QUEUES.filter((queue) => queue.name !== 'gateway.user.status')) {
      expect(name.endsWith(`.${routingKeys[0]}`)).toBe(true);
    }
  });

  it('declares the same settings when it runs again', async () => {
    const first = fakeModel();
    const second = fakeModel();
    await setupTopology(first);
    await setupTopology(second);
    expect(second.channel.assertQueue.mock.calls).toEqual(first.channel.assertQueue.mock.calls);
  });
});

describe('RabbitConnection', () => {
  it('connects with automatic recovery and returns at once', async () => {
    const { connection } = await startConnection();
    const options = amqplib.connect.mock.calls[0][1];

    expect(options.recovery).toMatchObject({ waitForConnect: false, maxRetries: Infinity });
    expect(connection.isConnected).toBe(false);
  });

  it('runs the onConnect functions on every reconnect, in order', async () => {
    const { connection, recovering, connect } = await startConnection();
    const calls = [];
    connection.onConnect(async () => calls.push('topology'));
    connection.onConnect(async () => calls.push('consumer'));

    await connect();
    expect(connection.isConnected).toBe(true);

    recovering.emit('disconnect', new Error('socket closed'));
    expect(connection.isConnected).toBe(false);
    await connect();

    expect(calls).toEqual(['topology', 'consumer', 'topology', 'consumer']);
  });

  it('runs an onConnect function at once when already connected', async () => {
    const { connection, connect } = await startConnection();
    const model = await connect();
    const fn = vi.fn(async () => {});
    connection.onConnect(fn);
    expect(fn).toHaveBeenCalledWith(model);
  });

  it('logs connection problems instead of crashing', async () => {
    const { recovering, logger } = await startConnection();
    recovering.emit('error', new Error('boom'));
    recovering.emit('connect-failed', new Error('ECONNREFUSED'));
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});

describe('EventPublisher', () => {
  it('sends the common message shape as persistent JSON and waits for the confirm', async () => {
    const { connection, connect } = await startConnection();
    const { channel } = await connect();
    const publisher = new EventPublisher({ connection, source: 'auth-service', logger: fakeLogger() });

    const data = { userId: 16, action: 'login', details: null, ipAddress: '39.45.12.8', occurredAt: '2026-10-07T09:41:00Z' };
    const message = await publisher.publish('audit.event', data);

    expect(message).toEqual({
      messageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: 'audit.event',
      version: 1,
      source: 'auth-service',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      data,
    });
    const [exchange, routingKey, content, options] = channel.publish.mock.calls[0];
    expect(exchange).toBe('mediassist.events');
    expect(routingKey).toBe('audit.event');
    expect(JSON.parse(content.toString('utf8'))).toEqual(message);
    expect(options).toMatchObject({
      persistent: true,
      contentType: 'application/json',
      messageId: message.messageId,
      type: 'audit.event',
    });
  });

  it('keeps Urdu text as UTF-8', async () => {
    const { connection, connect } = await startConnection();
    const { channel } = await connect();
    const publisher = new EventPublisher({ connection, source: 'consultation-service', logger: fakeLogger() });

    await publisher.publish('followup.changed', { note: 'مریض کو بخار ہے' });
    expect(JSON.parse(channel.publish.mock.calls[0][2].toString('utf8')).data.note).toBe('مریض کو بخار ہے');
  });

  it('gives each message a new messageId and reuses one channel', async () => {
    const { connection, connect } = await startConnection();
    const model = await connect();
    const publisher = new EventPublisher({ connection, source: 'auth-service', logger: fakeLogger() });

    const first = await publisher.publish('audit.event', {});
    const second = await publisher.publish('audit.event', {});
    expect(first.messageId).not.toBe(second.messageId);
    expect(model.createConfirmChannel).toHaveBeenCalledTimes(1);
  });

  it('uses the messageId the caller gives', async () => {
    const { connection, connect } = await startConnection();
    const model = await connect();
    const publisher = new EventPublisher({ connection, source: 'prescription-service', logger: fakeLogger() });
    const messageId = 'a1b2c3d4-0005-4000-8000-000000000005';

    const message = await publisher.publish('prescription.send', {}, { messageId });
    expect(message.messageId).toBe(messageId);
    const [, , content, options] = model.channel.publish.mock.calls[0];
    expect(JSON.parse(content.toString('utf8')).messageId).toBe(messageId);
    expect(options.messageId).toBe(messageId);
  });

  it('rejects at once when RabbitMQ is not connected', async () => {
    const { connection } = await startConnection();
    const publisher = new EventPublisher({ connection, source: 'auth-service', logger: fakeLogger() });
    await expect(publisher.publish('audit.event', {})).rejects.toThrow('RabbitMQ is not connected.');
  });

  it('rejects when RabbitMQ does not confirm the message', async () => {
    const { connection, connect } = await startConnection();
    await connect(fakeModel(fakeChannel({ confirm: new Error('message nacked') })));
    const publisher = new EventPublisher({ connection, source: 'auth-service', logger: fakeLogger() });
    await expect(publisher.publish('audit.event', {})).rejects.toThrow('message nacked');
  });

  it('opens a new channel after the old one closed', async () => {
    const { connection, connect } = await startConnection();
    const model = await connect();
    const publisher = new EventPublisher({ connection, source: 'auth-service', logger: fakeLogger() });

    await publisher.publish('audit.event', {});
    model.channel.emit('close');
    await publisher.publish('audit.event', {});
    expect(model.createConfirmChannel).toHaveBeenCalledTimes(2);
  });
});

describe('EventConsumer', () => {
  const queue = 'notification.followup.changed';
  const body = { messageId: 'a1b2', type: 'followup.changed', version: 1, source: 'consultation-service', data: { consultationId: 41 } };

  function delivery({ content = JSON.stringify(body), failures = 0 } = {}) {
    const deaths = failures ? [{ queue, reason: 'rejected', count: failures }, { queue: `${queue}.retry`, reason: 'expired', count: failures }] : undefined;
    return {
      content: Buffer.from(content, 'utf8'),
      properties: { messageId: 'a1b2', type: 'followup.changed', contentType: 'application/json', headers: deaths ? { 'x-death': deaths } : {} },
    };
  }

  async function startConsumer(handler, options) {
    const { connection, connect, logger } = await startConnection();
    new EventConsumer({ connection, logger }).consume(queue, handler, options);
    const { channel } = await connect();
    return { channel, logger };
  }

  it('reads with manual ack and the given prefetch', async () => {
    const { channel } = await startConsumer(async () => {}, { prefetch: 5 });
    expect(channel.prefetch).toHaveBeenCalledWith(5);
    expect(channel.consume).toHaveBeenCalledWith(queue, expect.any(Function), { noAck: false });
  });

  it('uses prefetch 10 by default', async () => {
    const { channel } = await startConsumer(async () => {});
    expect(channel.prefetch).toHaveBeenCalledWith(10);
  });

  it('passes the parsed message to the handler and acks after it finished', async () => {
    const handler = vi.fn(async () => {});
    const { channel } = await startConsumer(handler);
    const msg = delivery();

    await channel.onMessage(msg);
    expect(handler).toHaveBeenCalledWith(body);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it.each([0, 1])('nacks without requeue after failure %i, and logs messageId and type', async (failures) => {
    const { channel, logger } = await startConsumer(async () => {
      throw new Error('database is down');
    });
    const msg = delivery({ failures });

    await channel.onMessage(msg);
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.sendToQueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'a1b2', type: 'followup.changed', tries: failures + 1 }),
      expect.any(String),
    );
  });

  it('moves the message to the dead-letter queue on the 3rd failure, then acks it', async () => {
    const { channel, logger } = await startConsumer(async () => {
      throw new Error('database is down');
    });
    const msg = delivery({ failures: 2 });

    await channel.onMessage(msg);
    const [target, content, options] = channel.sendToQueue.mock.calls[0];
    expect(target).toBe('notification.followup.changed.dlq');
    expect(content).toBe(msg.content);
    expect(options).toMatchObject({ persistent: true, messageId: 'a1b2', headers: { 'last-error': 'database is down' } });
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'a1b2', type: 'followup.changed', tries: 3 }),
      expect.any(String),
    );
  });

  it('runs onDeadLetter only after the 3rd failure, with the message and the error', async () => {
    const onDeadLetter = vi.fn(async () => {});
    const { channel } = await startConsumer(
      async () => {
        throw new Error('database is down');
      },
      { onDeadLetter },
    );

    await channel.onMessage(delivery({ failures: 1 }));
    expect(onDeadLetter).not.toHaveBeenCalled();

    await channel.onMessage(delivery({ failures: 2 }));
    expect(onDeadLetter).toHaveBeenCalledExactlyOnceWith(body, expect.objectContaining({ message: 'database is down' }));
  });

  it('only logs an error of onDeadLetter, after the message was moved and acked', async () => {
    const { channel, logger } = await startConsumer(
      async () => {
        throw new Error('database is down');
      },
      {
        onDeadLetter: async () => {
          throw new Error('still down');
        },
      },
    );
    const msg = delivery({ failures: 2 });

    await channel.onMessage(msg);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.objectContaining({ message: 'still down' }) }), expect.any(String));
  });

  it('treats a message that is not JSON as a failure and logs the AMQP messageId', async () => {
    const handler = vi.fn();
    const { channel, logger } = await startConsumer(handler);

    await channel.onMessage(delivery({ content: '{not json' }));
    expect(handler).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'a1b2', type: 'followup.changed' }), expect.any(String));
  });

  it('starts reading again after a reconnect', async () => {
    const { connection, recovering, connect, logger } = await startConnection();
    new EventConsumer({ connection, logger }).consume(queue, async () => {});
    const first = await connect();
    recovering.emit('disconnect', new Error('socket closed'));
    const second = await connect();

    expect(first.channel.consume).toHaveBeenCalledTimes(1);
    expect(second.channel.consume).toHaveBeenCalledTimes(1);
  });
});
