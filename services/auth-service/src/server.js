import { createApp } from './app.js';
import { FirebaseClient } from './clients/FirebaseClient.js';
import { config } from './config.js';
import { createPrismaClient } from './db/prisma.js';
import { logger } from './logger.js';
import { RefreshTokenRepository } from './repositories/RefreshTokenRepository.js';
import { SpecialtyRepository } from './repositories/SpecialtyRepository.js';
import { UserRepository } from './repositories/UserRepository.js';

const prisma = createPrismaClient(config.AUTH_DATABASE_URL);

const app = createApp({
  logger,
  config,
  userRepository: new UserRepository(prisma),
  refreshTokenRepository: new RefreshTokenRepository(prisma),
  specialtyRepository: new SpecialtyRepository(prisma),
  firebaseClient: new FirebaseClient({
    projectId: config.FIREBASE_PROJECT_ID,
    serviceAccountPath: config.FIREBASE_SERVICE_ACCOUNT_PATH,
  }),
});

const server = app.listen(config.AUTH_SERVICE_PORT, (err) => {
  if (err) {
    logger.fatal({ err }, 'Auth service could not start');
    process.exit(1);
  }
  logger.info(`Auth service listening on port ${config.AUTH_SERVICE_PORT}`);
});

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
