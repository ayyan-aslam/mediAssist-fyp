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
