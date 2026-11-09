import { errorHandler } from '@mediassist/common';
import express from 'express';
import { AdminUserController } from './controllers/AdminUserController.js';
import { AuthController } from './controllers/AuthController.js';
import { ProfileController } from './controllers/ProfileController.js';
import { SpecialtyController } from './controllers/SpecialtyController.js';
import { createRouter } from './routes.js';
import { AdminUserService } from './services/AdminUserService.js';
import { AuthService } from './services/AuthService.js';
import { CnicEncryptor } from './services/CnicEncryptor.js';
import { ProfileService } from './services/ProfileService.js';
import { RefreshTokenService } from './services/RefreshTokenService.js';
import { SpecialtyService } from './services/SpecialtyService.js';
import { TokenService } from './services/TokenService.js';
import { RequestValidator } from './validators/RequestValidator.js';

// Repositories, the Firebase client and the EventPublisher are passed in, so tests can replace them.
export function createApp({
  logger,
  config,
  userRepository,
  refreshTokenRepository,
  specialtyRepository,
  eventPublisher,
  firebaseClient,
}) {
  const authService = new AuthService({
    userRepository,
    firebaseClient,
    cnicEncryptor: new CnicEncryptor({ encryptionKey: config.CNIC_ENCRYPTION_KEY, hashKey: config.CNIC_HASH_KEY }),
    tokenService: new TokenService(config.JWT_SECRET),
    refreshTokenService: new RefreshTokenService(refreshTokenRepository),
    eventPublisher,
    logger,
  });
  const requestValidator = new RequestValidator();
  const authController = new AuthController({ requestValidator, authService });
  const profileController = new ProfileController({
    requestValidator,
    profileService: new ProfileService({ userRepository, specialtyRepository }),
  });
  const specialtyController = new SpecialtyController({
    specialtyService: new SpecialtyService(specialtyRepository),
  });

  const adminUserController = new AdminUserController({
    requestValidator,
    adminUserService: new AdminUserService({ userRepository, firebaseClient, eventPublisher, logger }),
  });

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(createRouter({ authController, profileController, specialtyController, adminUserController }));

  app.use(errorHandler(logger));
  return app;
}
