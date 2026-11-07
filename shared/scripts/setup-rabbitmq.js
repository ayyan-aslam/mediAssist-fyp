// Creates the exchange and all queues once (design doc 6.2), for local work before the
// Consultation Service exists. The Consultation Service runs the same setupTopology() at startup.
// Run: npm run rabbitmq:setup -w shared
import amqplib from 'amqplib';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { QUEUES, setupTopology } from '../src/messaging/topology.js';

const config = loadConfig(z.object({ RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }) }));

const connection = await amqplib.connect(config.RABBITMQ_URL);
try {
  await setupTopology(connection);
  console.log(`RabbitMQ is ready: 1 exchange and ${QUEUES.length * 3} queues.`);
} finally {
  await connection.close();
}
