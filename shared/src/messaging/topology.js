// RabbitMQ setup: design doc Section 6.2.

export const EXCHANGE = 'mediassist.events';

// A failed message waits this long in <queue>.retry, then goes back to the main queue.
export const RETRY_DELAY_MS = 10_000;

// After this many failed tries, the message goes to <queue>.dlq.
export const MAX_TRIES = 3;

// Every queue and the routing keys bound to it (design doc 6.2.2). Name: <reader>.<message type>.
export const QUEUES = [
  { name: 'consultation.audio.window.ready', routingKeys: ['audio.window.ready'] },
  { name: 'consultation.consultation.recorded', routingKeys: ['consultation.recorded'] },
  { name: 'ai-pipeline.transcript.ready', routingKeys: ['transcript.ready'] },
  { name: 'consultation.soap.generated', routingKeys: ['soap.generated'] },
  { name: 'consultation.soap.generation.failed', routingKeys: ['soap.generation.failed'] },
  { name: 'notification.prescription.send', routingKeys: ['prescription.send'] },
  { name: 'prescription.delivery.result', routingKeys: ['delivery.result'] },
  { name: 'notification.followup.changed', routingKeys: ['followup.changed'] },
  // One queue for both, so the messages for the same user stay in order.
  { name: 'gateway.user.status', routingKeys: ['user.suspended', 'user.activated'] },
  { name: 'audit.audit.event', routingKeys: ['audit.event'] },
];

export const retryQueue = (queue) => `${queue}.retry`;
export const deadLetterQueue = (queue) => `${queue}.dlq`;

// Creates the exchange and every queue. Safe to run again: RabbitMQ keeps what already exists.
// Only the Consultation Service calls this (at startup). Other services only connect.
// model: an amqplib connection, for example the one RabbitConnection.onConnect() passes in.
export async function setupTopology(model) {
  const channel = await model.createChannel();
  try {
    await channel.assertExchange(EXCHANGE, 'direct', { durable: true });

    for (const { name, routingKeys } of QUEUES) {
      // A rejected message goes to the retry queue (through the default exchange).
      await channel.assertQueue(name, {
        durable: true,
        arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': retryQueue(name) },
      });
      // After the wait, it goes back to the main queue.
      await channel.assertQueue(retryQueue(name), {
        durable: true,
        arguments: {
          'x-message-ttl': RETRY_DELAY_MS,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': name,
        },
      });
      await channel.assertQueue(deadLetterQueue(name), { durable: true });

      for (const routingKey of routingKeys) {
        await channel.bindQueue(name, EXCHANGE, routingKey);
      }
    }
  } finally {
    await channel.close();
  }
}
