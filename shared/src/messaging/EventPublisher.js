import { randomUUID } from 'node:crypto';
import { EXCHANGE } from './topology.js';

// Sends messages to the mediassist.events exchange, with the message type as the routing key.
// Message shape: design doc Section 6.3. Reliability settings: Section 6.2.3.
export class EventPublisher {
  #channel = null;

  constructor({ connection, source, logger }) {
    this.connection = connection;
    this.source = source;
    this.logger = logger;
  }

  // Resolves when RabbitMQ has saved the message (publisher confirm). Returns the sent message.
  // Rejects at once when RabbitMQ is not connected, so callers never wait for a reconnect.
  // messageId: optional, for a caller that saved the ID before sending (for example PRESCRIPTION_SEND).
  async publish(type, data, { messageId = randomUUID() } = {}) {
    const message = {
      messageId,
      type,
      version: 1,
      source: this.source,
      createdAt: new Date().toISOString(),
      data,
    };

    const channel = await this.#getChannel();
    await new Promise((resolve, reject) => {
      channel.publish(
        EXCHANGE,
        type,
        Buffer.from(JSON.stringify(message), 'utf8'),
        {
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          messageId: message.messageId,
          type,
          appId: this.source,
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return message;
  }

  // One confirm channel, opened on first use and again after it closes.
  #getChannel() {
    if (!this.connection.isConnected) {
      return Promise.reject(new Error('RabbitMQ is not connected.'));
    }
    this.#channel ??= this.connection.createConfirmChannel().then(
      (channel) => {
        // For example, the exchange does not exist yet. The open publish then fails too.
        channel.on('error', (err) => this.logger.error({ err }, 'RabbitMQ publish channel error'));
        channel.on('close', () => {
          this.#channel = null;
        });
        return channel;
      },
      (err) => {
        this.#channel = null;
        throw err;
      },
    );
    return this.#channel;
  }
}
