import { AppError } from '@mediassist/common';

// Statuses: design doc Section 5.1.3.

// The Auth & User Service is not responding. The admin can try again.
export const serviceUnavailableError = () =>
  new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is not responding. Please try again.');
