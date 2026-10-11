"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert } from "lucide-react";
import { z } from "zod";
import { AuthHeading } from "@/components/shared/auth-heading";
import { describedBy, FormField } from "@/components/shared/form-field";
import { PasswordInput } from "@/components/shared/password-input";
import { RuleList } from "@/components/shared/rule-list";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { startVerificationEmail } from "@/lib/firebase";
import { passwordRules, passwordSchema } from "@/lib/password";

// Same rules as the Auth & User Service (RequestValidator) and the Firebase password policy.
const PHONE = /^\+?\d{10,14}$/;
const normalizePhone = (value: string) => value.replace(/[\s-]/g, "");

const schema = z
  .object({
    fullName: z.string().trim().min(1, "Please enter your full name.").max(100, "Use 100 characters or fewer."),
    email: z
      .string()
      .trim()
      .min(1, "Please enter your email.")
      .max(150, "Use 150 characters or fewer.")
      .pipe(z.email("Please enter a valid email address.")),
    phone: z
      .string()
      .min(1, "Please enter your phone number.")
      .refine((v) => PHONE.test(normalizePhone(v)), "Enter 10 to 14 digits, for example 03001234567."),
    cnic: z.string().regex(/^\d{13}$/, "The CNIC must have exactly 13 digits."),
    registrationNo: z
      .string()
      .trim()
      .min(1, "Please enter your registration number.")
      .max(30, "Use 30 characters or fewer."),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please type your password again."),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match.",
    // Check the match even while other fields still have errors.
    when: (payload) => !payload.issues.some((issue) => issue.path?.[0] === "confirmPassword"),
  });

type Values = z.infer<typeof schema>;
type FieldName = keyof Values;

// Backend error code -> the field it belongs to (design doc 5.2, POST /auth/doctor/register).
const FIELD_BY_CODE: Record<string, FieldName> = {
  EMAIL_TAKEN: "email",
  PHONE_TAKEN: "phone",
  CNIC_INVALID: "cnic",
  CNIC_TAKEN: "cnic",
  REGISTRATION_NO_TAKEN: "registrationNo",
  PASSWORDS_DO_NOT_MATCH: "confirmPassword",
};

const FIELDS: FieldName[] = ["fullName", "email", "phone", "cnic", "registrationNo", "password", "confirmPassword"];

// VALIDATION_ERROR messages start with the field name, for example "phone: must be a valid phone number".
function serverFieldError(err: ApiError): { field: FieldName; message: string } | null {
  if (FIELD_BY_CODE[err.code]) return { field: FIELD_BY_CODE[err.code], message: err.message };
  if (err.code !== "VALIDATION_ERROR") return null;
  const match = /^(\w+): (.+)$/.exec(err.message);
  const field = match?.[1] as FieldName | undefined;
  if (!match || !field || !FIELDS.includes(field)) return null;
  const text = match[2];
  return { field, message: `${text[0].toUpperCase()}${text.slice(1)}.` };
}

export function DoctorSignupForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setError,
    setFocus,
    trigger,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { fullName: "", email: "", phone: "", cnic: "", registrationNo: "", password: "", confirmPassword: "" },
  });

  const [password, confirmPassword, cnic] = useWatch({ control, name: ["password", "confirmPassword", "cnic"] });
  const cnicField = register("cnic");
  // When the password changes, check the confirm field again, but only after the user has visited it.
  const passwordField = register("password", {
    onChange: () => {
      if (getFieldState("confirmPassword").isTouched) trigger("confirmPassword");
    },
  });

  async function onSubmit(values: Values) {
    setFormError(null);
    const email = values.email.trim();

    try {
      await authApi.registerDoctor({
        fullName: values.fullName.trim(),
        email,
        phone: normalizePhone(values.phone),
        cnic: values.cnic,
        registrationNo: values.registrationNo.trim(),
        password: values.password,
        confirmPassword: values.confirmPassword,
      });
    } catch (err) {
      const fieldError = err instanceof ApiError ? serverFieldError(err) : null;
      if (fieldError) {
        setError(fieldError.field, { type: "server", message: fieldError.message });
        setFocus(fieldError.field);
      } else {
        setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
      return;
    }

    // The account exists now. Sign in with Firebase and send the verification email (design doc 7.3)
    // in the background, so the next screen opens at once. That screen shows if the email failed.
    startVerificationEmail(email, values.password);
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  return (
    <>
      <AuthHeading title="Create your doctor account">
        Record consultations and get SOAP notes and draft prescriptions in seconds.
      </AuthHeading>

      {formError && (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <FormField id="fullName" label="Full name" error={errors.fullName?.message}>
          <Input
            id="fullName"
            autoComplete="name"
            placeholder="Dr. Sara Ahmed"
            aria-invalid={!!errors.fullName}
            aria-describedby={describedBy("fullName")}
            {...register("fullName")}
          />
        </FormField>

        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="sara@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={describedBy("email")}
            {...register("email")}
          />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="phone" label="Phone number" error={errors.phone?.message} hint="For example 03001234567">
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="03001234567"
              aria-invalid={!!errors.phone}
              aria-describedby={describedBy("phone")}
              {...register("phone")}
            />
          </FormField>

          <FormField id="registrationNo" label="Registration number" error={errors.registrationNo?.message} hint="Your PMDC number">
            <Input
              id="registrationNo"
              autoComplete="off"
              placeholder="PMDC-12345"
              aria-invalid={!!errors.registrationNo}
              aria-describedby={describedBy("registrationNo")}
              {...register("registrationNo")}
            />
          </FormField>
        </div>

        <FormField
          id="cnic"
          label="CNIC"
          error={errors.cnic?.message}
          hint={
            <span className="flex justify-between gap-2">
              <span>13 digits, without dashes</span>
              <span className={cnic.length === 13 ? "font-semibold text-success tabular-nums" : "tabular-nums"}>
                {cnic.length}/13
              </span>
            </span>
          }
        >
          <Input
            id="cnic"
            inputMode="numeric"
            autoComplete="off"
            placeholder="3520212345671"
            maxLength={13}
            aria-invalid={!!errors.cnic}
            aria-describedby={describedBy("cnic")}
            {...cnicField}
            onChange={(e) => {
              e.target.value = e.target.value.replace(/\D/g, "").slice(0, 13);
              return cnicField.onChange(e);
            }}
          />
        </FormField>

        <FormField
          id="password"
          label="Password"
          error={errors.password?.message}
          hint={<RuleList rules={passwordRules(password)} />}
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={describedBy("password")}
            {...passwordField}
          />
        </FormField>

        <FormField
          id="confirmPassword"
          label="Confirm password"
          error={errors.confirmPassword?.message}
          hint={passwordsMatch ? <RuleList rules={[{ label: "Passwords match", met: true }]} /> : undefined}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={describedBy("confirmPassword")}
            {...register("confirmPassword")}
          />
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner className="size-4 text-current" label="Creating account" />}
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
