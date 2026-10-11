import crypto from 'node:crypto';
import { AppError } from '@mediassist/common';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function invalidTokenError() {
  return new AppError(401, 'REFRESH_TOKEN_INVALID', 'Your session has ended. Please log in again.');
}

// Refresh tokens are random values. Only their SHA-256 hash is saved.
export class RefreshTokenService {
  constructor(refreshTokenRepository) {
    this.refreshTokenRepository = refreshTokenRepository;
  }

  async create(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await this.refreshTokenRepository.save({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    return token;
  }

  // Replaces a valid token with a new one. The old token stops working.
  async rotate(refreshToken) {
    const row = await this.refreshTokenRepository.findByHash(hashToken(refreshToken));
    if (!row || row.expiresAt <= new Date()) {
      throw invalidTokenError();
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    const replaced = await this.refreshTokenRepository.replace(row.tokenId, {
      userId: row.userId,
      tokenHash: hashToken(newToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    // Another request used the same token at the same moment.
    if (!replaced) {
      throw invalidTokenError();
    }
    return { userId: row.userId, refreshToken: newToken };
  }

  async revoke(refreshToken) {
    await this.refreshTokenRepository.deleteByHash(hashToken(refreshToken));
  }
}
