import { SignJWT } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// Creates the access token (JWT, HS256). It carries the user ID, role, name and email.
export class TokenService {
  constructor(secret) {
    this.key = new TextEncoder().encode(secret);
  }

  createAccessToken({ userId, role, name, email }) {
    return new SignJWT({ userId, role, name, email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }
}
