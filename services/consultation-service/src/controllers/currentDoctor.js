import { AppError } from '@mediassist/common';

// The API Gateway checks the token and the role and sends the user in the x-user-* headers.
// The doctor ID always comes from here, never from the body or the URL.
export function currentDoctorId(req) {
  const userId = Number(req.get('x-user-id'));
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError(401, 'UNAUTHORIZED', 'The access token is missing.');
  }
  if (req.get('x-user-role') !== 'doctor') {
    throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this.');
  }
  return userId;
}

// The API Gateway sends the client IP on every route (used for the audit log).
export function clientIp(req) {
  return req.get('x-user-ip') ?? req.ip;
}

// The doctor's name from the access token. The API Gateway sends it URL-encoded.
export function currentDoctorName(req) {
  try {
    return decodeURIComponent(req.get('x-user-name') ?? '');
  } catch {
    return '';
  }
}

// The doctor's email from the access token.
export function currentDoctorEmail(req) {
  return req.get('x-user-email') ?? '';
}
