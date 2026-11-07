import { deadLetterQueue, MAX_TRIES } from './topology.js';

// How many times the message already failed in this queue. RabbitMQ counts each nack
// in the x-death header (design doc 6.2.4).
function previousFailures(msg, queue) {
  const deaths = msg.properties.headers?.['x-death'] ?? [];
  const entry = deaths.find((death) => death.queue === queue && death.reason === 'rejected');
  return entry ? Number(entry.count) : 0;
}

// Reads messages from a queue. Manual ack: a message is confirmed only after the handler has finished.
// On error: nack without requeue, so it waits 10 s in <queue>.retry. The 3rd failure goes to <queue>.dlq.
export class EventConsumer {
  constructor({ connection, logger }) {
    this.connection = connection;
    this.logger = logger;
  }

  // handler(message) gets the whole message (messageId, type, version, source, createdAt, data).
  // It must be safe to run twice with the same message.
  // onDeadLetter(message, err), optional: runs once the message has moved to the dead-letter queue, so the
  // service can mark the work as failed instead of leaving it waiting. Its own errors are only logged.
  consume(queue, handler, { prefetch = 10, onDeadLetter } = {}) {
    this.connection.onConnect(async (model) => {
      const channel = await model.createConfirmChannel();
      channel.on('error', (err) => this.logger.error({ err, queue }, 'RabbitMQ consumer channel error'));
      await channel.prefetch(prefetch);
      await channel.consume(queue, (msg) => this.#handle(channel, queue, handler, msg, onDeadLetter), { noAck: false });
      this.logger.info({ queue, prefetch }, 'Listening to queue');
    });
  }

  async #handle(channel, queue, handler, msg, onDeadLetter) {
    // RabbitMQ cancelled the consumer, for example because the queue was deleted.
    if (msg === null) {
      this.logger.error({ queue }, 'RabbitMQ cancelled the consumer');
      return;
    }

    let message = null;
    try {
      message = JSON.parse(msg.content.toString('utf8'));
      await handler(message);
      channel.ack(msg);
    } catch (err) {
      await this.#fail(channel, queue, msg, message, err, onDeadLetter);
    }
  }

  async #fail(channel, queue, msg, message, err, onDeadLetter) {
    const tries = previousFailures(msg, queue) + 1;
    const log = {
      err,
      queue,
      messageId: message?.messageId ?? msg.properties.messageId,
      type: message?.type ?? msg.properties.type,
      tries,
    };

    try {
      if (tries < MAX_TRIES) {
        this.logger.warn(log, 'Message failed. It will be tried again in 10 seconds.');
        channel.nack(msg, false, false);
        return;
      }

      this.logger.error(log, 'Message failed 3 times. Moving it to the dead-letter queue.');
      await new Promise((resolve, reject) => {
        channel.sendToQueue(
          deadLetterQueue(queue),
          msg.content,
          { ...msg.properties, persistent: true, headers: { ...msg.properties.headers, 'last-error': err.message } },
          (sendErr) => (sendErr ? reject(sendErr) : resolve()),
        );
      });
      channel.ack(msg);
    } catch (sendErr) {
      // The channel is gone. The message was not acked, so RabbitMQ delivers it again after the reconnect.
      this.logger.error({ ...log, err: sendErr }, 'Could not move the message after a failure');
      return;
    }

    if (onDeadLetter && message) {
      try {
        await onDeadLetter(message, err);
      } catch (hookErr) {
        this.logger.error({ ...log, err: hookErr }, 'The dead-letter handler failed');
      }
    }
  }
}
