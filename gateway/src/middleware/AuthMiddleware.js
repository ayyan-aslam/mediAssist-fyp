import { AppError } from '@mediassist/common';
import { errors, jwtVerify } from 'jose';

function unauthorized(message) {
  return new AppError(401, 'UNAUTHORIZED', message);
}

// Checks the access token (JWT, HS256) made by the Auth & User Service.
// On success it sets req.user = { userId, role, name, email }.
export class AuthMiddleware {
  constructor({ jwtSecret, isPublicRoute }) {
    this.key = new TextEncoder().encode(jwtSecret);
    this.isPublicRoute = isPublicRoute;
  }

  authenticate = async (req, res, next) => {
    if (this.isPublicRoute(req)) {
      return next();
    }

    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
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

    req.user = { userId, role, name, email };
    next();
  };
}
