import amqplib from 'amqplib';

// One RabbitMQ connection for a service. amqplib reconnects by itself after a connection loss
// (waiting 1 s, then longer, up to 30 s), and runs the onConnect() functions after every (re)connect,
// so the topology and the consumers come back too.
export class RabbitConnection {
  #setups = [];
  #connection = null;
  #model = null;

  constructor({ url, logger }) {
    this.url = url;
    this.logger = logger;
  }

  // Returns at once. The first connection, and every reconnect, happen in the background,
  // so the service also starts when RabbitMQ is down.
  async start() {
    this.#connection = await amqplib.connect(this.url, {
      recovery: {
        waitForConnect: false,
        initialDelay: 1000,
        maxDelay: 30_000,
        maxRetries: Infinity,
        setup: (model) => this.#runSetups(model),
      },
    });

    this.#connection.on('connect', (model) => {
      this.#model = model;
      this.logger.info('Connected to RabbitMQ');
    });
    this.#connection.on('disconnect', (err) => {
      this.#model = null;
      this.logger.error({ err }, 'Lost the RabbitMQ connection. Reconnecting.');
    });
    this.#connection.on('connect-failed', (err) => {
      this.logger.error({ err }, 'Could not connect to RabbitMQ. Trying again.');
    });
    // Without a listener, an 'error' event would stop the process.
    this.#connection.on('error', (err) => {
      this.logger.error({ err }, 'RabbitMQ connection error');
    });
  }

  get isConnected() {
    return this.#model !== null;
  }

  // fn(model) runs after every (re)connect, in the order added. If it throws, amqplib
  // drops that connection and tries again. When already connected, fn also runs now.
  onConnect(fn) {
    this.#setups.push(fn);
    if (this.#model) {
      Promise.resolve(fn(this.#model)).catch((err) => {
        this.logger.error({ err }, 'RabbitMQ setup failed');
      });
    }
  }

  // Waits for a connection when there is none, so check isConnected first if that must not happen.
  createConfirmChannel() {
    return this.#connection.createConfirmChannel();
  }

  async close() {
    await this.#connection?.close();
    this.#model = null;
  }

  async #runSetups(model) {
    for (const fn of this.#setups) {
      await fn(model);
    }
  }
}
