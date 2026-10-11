import { errorHandler } from '@mediassist/common';
import express from 'express';
import { AuthController } from './controllers/AuthController.js';
import { SpecialtyController } from './controllers/SpecialtyController.js';
import { createRouter } from './routes.js';
import { AuthService } from './services/AuthService.js';
import { CnicEncryptor } from './services/CnicEncryptor.js';
import { RefreshTokenService } from './services/RefreshTokenService.js';
import { SpecialtyService } from './services/SpecialtyService.js';
import { TokenService } from './services/TokenService.js';
import { RequestValidator } from './validators/RequestValidator.js';

// Repositories and the Firebase client are passed in, so tests can replace them.
export function createApp({
  logger,
  config,
  userRepository,
  refreshTokenRepository,
  specialtyRepository,
  firebaseClient,
}) {
  const authService = new AuthService({
    userRepository,
    firebaseClient,
    cnicEncryptor: new CnicEncryptor({ encryptionKey: config.CNIC_ENCRYPTION_KEY, hashKey: config.CNIC_HASH_KEY }),
    tokenService: new TokenService(config.JWT_SECRET),
    refreshTokenService: new RefreshTokenService(refreshTokenRepository),
    logger,
  });
  const authController = new AuthController({ requestValidator: new RequestValidator(), authService });
  const specialtyController = new SpecialtyController({
    specialtyService: new SpecialtyService(specialtyRepository),
  });

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(createRouter({ authController, specialtyController }));

  app.use(errorHandler(logger));
  return app;
}
