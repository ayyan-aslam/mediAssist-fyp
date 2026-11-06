import { AppError } from '@mediassist/common';
import { z } from 'zod';

// Field rules: design doc Section 4.4.4 (column sizes) and Section 4.6 (allowed values).
// Names can be Urdu, English or Punjabi, so only the length is checked.
const fullName = z.string().trim().min(1).max(100);
const phone = z.string().trim().regex(/^\+?\d{10,14}$/, 'must be a valid phone number');
const email = z.string().trim().toLowerCase().max(150).pipe(z.email()).nullable();
const age = z.int().min(0).max(120);
const gender = z.enum(['male', 'female', 'other']);

const createPatientSchema = z.object({
  fullName,
  phone,
  email: email.optional().default(null),
  age,
  gender,
});

// PATCH: only the fields that changed. Unknown fields are rejected.
const updatePatientSchema = z.strictObject({
  fullName: fullName.optional(),
  phone: phone.optional(),
  email: email.optional(),
  age: age.optional(),
  gender: gender.optional(),
});

const findPatientSchema = z.object({ phone });
// IDs are PostgreSQL INT (SERIAL) values.
const MAX_ID = 2_147_483_647;
const startConsultationSchema = z.object({ clinicalPatientId: z.int().positive().max(MAX_ID) });

// Multipart text fields arrive as strings. part_no is a SMALLINT; parts after 180 are refused later
// with RECORDING_TOO_LONG. duration_sec is an INT, so the length is rounded to whole seconds
// (a part of 10.02 s is 10), but a very short last part still counts as 1 second.
const audioPartSchema = z.object({
  partNo: z.coerce.number().int().positive().max(32_767),
  durationSec: z.coerce
    .number()
    .positive()
    .max(60)
    .transform((sec) => Math.max(1, Math.round(sec))),
});

function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    throw new AppError(400, 'VALIDATION_ERROR', path ? `${path}: ${issue.message}` : issue.message);
  }
  return result.data;
}

export class RequestValidator {
  validateCreatePatient(body) {
    return parse(createPatientSchema, body);
  }

  validateUpdatePatient(body) {
    return parse(updatePatientSchema, body);
  }

  validateFindPatient(query) {
    return parse(findPatientSchema, query);
  }

  validateStartConsultation(body) {
    return parse(startConsultationSchema, body);
  }

  // req.body and req.file from the audio upload middleware.
  validateAudioPart(body, file) {
    if (!file) throw new AppError(400, 'VALIDATION_ERROR', 'audio: the audio file is missing');
    return parse(audioPartSchema, body);
  }

  // An ID in the URL. A value that is not a valid ID cannot exist, so notFoundError() is thrown.
  parseId(value, notFoundError) {
    const id = Number(value);
    if (!/^\d+$/.test(value) || id <= 0 || id > MAX_ID) {
      throw notFoundError();
    }
    return id;
  }
}
