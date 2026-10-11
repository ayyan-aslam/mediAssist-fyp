import { z } from "zod";

// Password rule (design doc 2.2, Security): 8+ characters with an uppercase letter, a lowercase letter,
// a number and a special character. The same rule as the Firebase password policy and the
// Auth & User Service (RequestValidator). Used by sign-up and password reset.

// The special characters that the Firebase password policy accepts (its allowedNonAlphanumericCharacters).
const SPECIAL = /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`-]/;

export const PASSWORD_HINT = "Use 8+ characters with uppercase and lowercase letters, a number and a symbol.";

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .regex(/[A-Z]/, "Add an uppercase letter (A–Z).")
  .regex(/[a-z]/, "Add a lowercase letter (a–z).")
  .regex(/\d/, "Add a number (0–9).")
  .regex(SPECIAL, "Add a symbol, for example ! @ # % or &.");

// The live checklist shown under the password field.
export function passwordRules(password: string) {
  return [
    { label: "8+ characters", met: password.length >= 8 },
    { label: "Uppercase", met: /[A-Z]/.test(password) },
    { label: "Lowercase", met: /[a-z]/.test(password) },
    { label: "Number", met: /\d/.test(password) },
    { label: "Symbol (! @ # % &)", met: SPECIAL.test(password) },
  ];
}
