import { AppError } from '@mediassist/common';

// Error codes: design doc Section 5.7. Statuses: Section 5.1.3.

// Also used for another doctor's prescription: it is reported as not found (404), never as forbidden.
export const prescriptionNotFoundError = () =>
  new AppError(404, 'PRESCRIPTION_NOT_FOUND', 'This prescription was not found.');

export const consultationNotFoundError = () =>
  new AppError(404, 'CONSULTATION_NOT_FOUND', 'This consultation was not found.');

export const prescriptionExistsError = (prescriptionId) =>
  new AppError(409, 'PRESCRIPTION_EXISTS', 'This prescription is already final.', { prescriptionId });

export const prescriptionEmptyError = () =>
  new AppError(409, 'PRESCRIPTION_EMPTY', 'Add at least one medicine before you finalize the prescription.');

export const channelNotAvailableError = () =>
  new AppError(400, 'CHANNEL_NOT_AVAILABLE', 'The prescription can only be sent by email for now.');

export const noEmailError = () =>
  new AppError(409, 'NO_EMAIL', 'The patient has no email address. Add one to the patient details first.');

// The Consultation Service, Amazon S3 or RabbitMQ is not responding. The doctor can try again.
export const serviceUnavailableError = () =>
  new AppError(503, 'SERVICE_UNAVAILABLE', 'The service is not responding. Please try again.');
