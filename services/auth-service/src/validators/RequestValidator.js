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
}
