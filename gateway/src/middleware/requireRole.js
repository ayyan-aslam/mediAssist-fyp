import { AppError } from '@mediassist/common';

// Blocks a logged-in user whose role cannot call this route (design doc Section 3.3).
export function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this.');
    }
    next();
  };
}
