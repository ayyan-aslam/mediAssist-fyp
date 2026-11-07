import { AppError } from '@mediassist/common';
import { errors, jwtVerify } from 'jose';

function unauthorized(message) {
  return new AppError(401, 'UNAUTHORIZED', message);
}

function readBearerToken(req) {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}

// Checks the access token (JWT, HS256) made by the Auth & User Service.
// On success it sets req.user = { userId, role, name, email }.
export class AuthMiddleware {
  constructor({ jwtSecret }) {
    this.key = new TextEncoder().encode(jwtSecret);
  }

  authenticate = async (req, res, next) => {
    req.user = await this.verify(readBearerToken(req));
    next();
  };

  // SSE streams only: a browser EventSource cannot send headers, so the token may come in ?token=
  // (design doc Section 5.1.4).
  authenticateSse = async (req, res, next) => {
    const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
    req.user = await this.verify(readBearerToken(req) ?? queryToken);
    next();
  };

  async verify(token) {
    if (!token) {
      throw unauthorized('The access token is missing.');
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] }));
    } catch (err) {
      if (err instanceof errors.JWTExpired) {
        throw unauthorized('The access token has expired.');
      }
      throw unauthorized('The access token is not valid.');
    }

    const { userId, role, name, email } = payload;
    if (!userId || !role) {
      throw unauthorized('The access token is not valid.');
    }
    return { userId, role, name, email };
  }
}
