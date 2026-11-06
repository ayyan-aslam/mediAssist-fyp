import { AppError } from '@mediassist/common';

// Also used for another doctor's records: they are reported as not found (404), never as forbidden.
export const patientNotFoundError = () => new AppError(404, 'PATIENT_NOT_FOUND', 'This patient was not found.');

export const consultationNotFoundError = () =>
  new AppError(404, 'CONSULTATION_NOT_FOUND', 'This consultation was not found.');

export const notRecordingError = () =>
  new AppError(409, 'NOT_RECORDING', 'This consultation is not recording any more.');

export const recordingTooLongError = () =>
  new AppError(409, 'RECORDING_TOO_LONG', 'A recording can be up to 30 minutes long.');
