import { z } from "zod";

// Pakistani mobile numbers: 03XXXXXXXXX, or the same number with +92 / 0092 / 92 in front.
// Spaces and dashes are allowed while typing.
const PK_MOBILE = /^(?:\+92|0092|92|0)(3\d{9})$/;

// Returns the number as 03XXXXXXXXX, or null when it is not a Pakistani mobile number.
export function normalizePkPhone(value: string) {
  const match = PK_MOBILE.exec(value.replace(/[\s-]/g, ""));
  return match ? `0${match[1]}` : null;
}

export const PK_PHONE_EXAMPLE = "03001234567";

export const pkPhoneSchema = z
  .string()
  .trim()
  .min(1, "Please enter your phone number.")
  .refine((value) => normalizePkPhone(value) !== null, `Enter a Pakistani mobile number, for example ${PK_PHONE_EXAMPLE}.`);
