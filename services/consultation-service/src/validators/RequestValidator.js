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

// Up to 180 parts: 30 minutes (design doc 3.4.4).
const stopSchema = z.object({ totalParts: z.int().positive().max(180) });

// PATCH soap-note: only the parts that changed, at least one. An empty part (null) is saved as "".
const soapPart = z
  .string()
  .max(10_000)
  .nullable()
  .optional()
  .transform((value) => (value === null ? '' : value));
// The doctor's edited prescription and symptoms. aiIndex: the AI item it came from, or null for a new one;
// reviewIndex: the AI suggestion (for_doctor_review) the doctor accepted. null for the whole list goes back
// to the AI version.
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value || null);
const aiIndex = z.int().min(0).max(99).nullable().default(null);
const prescriptionSchema = z
  .array(
    z.strictObject({
      aiIndex,
      reviewIndex: aiIndex,
      name: z.string().trim().min(1).max(200),
      genericName: optionalText(200),
      dose: optionalText(100),
      frequency: optionalText(100),
      duration: optionalText(100),
      instructions: optionalText(500),
    }),
  )
  .max(30)
  .nullable()
  .optional();
const symptomsSchema = z
  .array(z.strictObject({ aiIndex, symptom: z.string().trim().min(1).max(100) }))
  .max(50)
  .nullable()
  .optional();
const soapNoteChangesSchema = z
  .strictObject({
    subjective: soapPart,
    objective: soapPart,
    assessment: soapPart,
    plan: soapPart,
    prescription: prescriptionSchema,
    symptoms: symptomsSchema,
  })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), 'send at least one part');

// PUT follow-up: a date as YYYY-MM-DD, or null to remove it. The field must be sent.
const followUpSchema = z.object({ followUpDate: z.iso.date().nullable() });

// Internal prescription-source: the doctor the consultation must belong to.
const prescriptionSourceSchema = z.object({ doctorId: z.coerce.number().int().positive().max(MAX_ID) });

// Lists and pages (design doc 5.1.2). Query values arrive as strings.
const pageSchema = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const listSchema = z.object(pageSchema);
// Search by patient name or phone: at least 2 characters.
const searchText = z.string().trim().min(2).max(100);
const searchSchema = z.object({ q: searchText, ...pageSchema });
// The patients list: the search text is optional.
const patientListSchema = z.object({ q: searchText.optional(), ...pageSchema });

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

  validateStop(body) {
    return parse(stopSchema, body);
  }

  validateSoapNoteChanges(body) {
    const changes = parse(soapNoteChangesSchema, body);
    return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
  }

  validateFollowUp(body) {
    return parse(followUpSchema, body);
  }

  validatePrescriptionSource(query) {
    return parse(prescriptionSourceSchema, query);
  }

  validateList(query) {
    return parse(listSchema, query);
  }

  validateSearch(query) {
    return parse(searchSchema, query);
  }

  validatePatientList(query) {
    return parse(patientListSchema, query);
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
