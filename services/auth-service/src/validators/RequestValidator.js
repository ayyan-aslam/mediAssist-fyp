import { AppError } from '@mediassist/common';
import { z } from 'zod';

// Field rules: design doc FR-7, Section 4.4.1 (column sizes) and the Firebase password policy.
const fullName = z.string().trim().min(1).max(100);
const email = z.string().trim().toLowerCase().max(150).pipe(z.email());
const phone = z.string().trim().regex(/^\+?\d{10,14}$/, 'must be a valid phone number');
// The special characters that the Firebase password policy accepts (its allowedNonAlphanumericCharacters).
const SPECIAL_CHARACTERS = /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`-]/;
const password = z
  .string()
  .min(8, 'must have at least 8 characters')
  .regex(/[A-Z]/, 'must contain an uppercase letter')
  .regex(/[a-z]/, 'must contain a lowercase letter')
  .regex(/\d/, 'must contain a number')
  .regex(SPECIAL_CHARACTERS, 'must contain a special character');

const registerSchemas = {
  doctor: z.object({
    fullName,
    email,
    phone,
    cnic: z.string().trim(),
    registrationNo: z.string().trim().min(1).max(30),
    password,
    confirmPassword: z.string(),
  }),
};

// PATCH /users/me: only the fields that changed. Unknown fields (email, cnic, ...) are rejected.
// Patients and doctors only; admins cannot edit their profile (design doc Section 5.2).
const profileUpdateSchemas = {
  patient: z.strictObject({
    fullName: fullName.optional(),
    phone: phone.optional(),
    dateOfBirth: z.iso
      .date()
      .transform((value) => new Date(value))
      .nullable()
      .optional(),
    gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  }),
  doctor: z.strictObject({
    fullName: fullName.optional(),
    phone: phone.optional(),
    specialtyId: z.int().positive().nullable().optional(),
  }),
};

// The largest value of a SERIAL (INT) column.
const MAX_ID = 2_147_483_647;
const id = z.coerce.number().int().positive().max(MAX_ID);

// GET /admin/users (design doc 5.2). Query values arrive as strings. Lists and pages: Section 5.1.2.
const adminUserListSchema = z.object({
  search: z.string().trim().max(150).optional().transform((value) => value || undefined),
  role: z.enum(['patient', 'doctor', 'admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  specialtyId: id.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /internal/users?ids=15,16
const userIdsSchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(',').map((part) => part.trim()))
    .pipe(z.array(z.string().regex(/^\d+$/, 'must be a list of user IDs').pipe(id)).min(1).max(100))
    .transform((ids) => [...new Set(ids)]),
});

const loginSchema = z.object({ firebaseToken: z.string().min(1) });
const refreshTokenSchema = z.object({ refreshToken: z.string().min(1) });

function parse(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    throw new AppError(400, 'VALIDATION_ERROR', path ? `${path}: ${issue.message}` : issue.message);
  }
  return result.data;
}

export class RequestValidator {
  validateRegister(body, role) {
    const data = parse(registerSchemas[role], body);

    if ('cnic' in data && !/^\d{13}$/.test(data.cnic)) {
      throw new AppError(400, 'CNIC_INVALID', 'The CNIC must have exactly 13 digits.');
    }
    if (data.password !== data.confirmPassword) {
      throw new AppError(400, 'PASSWORDS_DO_NOT_MATCH', 'The passwords do not match.');
    }

    const { confirmPassword, ...rest } = data;
    return rest;
  }

  validateLogin(body) {
    return parse(loginSchema, body);
  }

  validateRefreshToken(body) {
    return parse(refreshTokenSchema, body);
  }

  validateAdminUserList(query) {
    return parse(adminUserListSchema, query);
  }

  validateUserIds(query) {
    return parse(userIdsSchema, query).ids;
  }

  // A user ID in the URL. A value that is not a valid ID cannot exist, so it is 404 USER_NOT_FOUND.
  parseUserId(value) {
    const result = id.safeParse(value);
    if (!/^\d+$/.test(value) || !result.success) {
      throw new AppError(404, 'USER_NOT_FOUND', 'This user was not found.');
    }
    return result.data;
  }

  validateProfileUpdate(body, role) {
    const schema = profileUpdateSchemas[role];
    if (!schema) {
      throw new AppError(403, 'FORBIDDEN', 'You cannot edit this profile.');
    }
    return parse(schema, body);
  }
}

// scripts/create-admin.js checks ADMIN_PASSWORD with the same rules.
export { password as passwordSchema };
