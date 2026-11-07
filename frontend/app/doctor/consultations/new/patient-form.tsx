"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { describedBy, FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/form-error";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import type { ClinicalPatient, Gender } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

// Same rules as the Consultation Service (design doc 4.4.4 and 4.6). Age stays text in the form.
const schema = z.object({
  fullName: z.string().trim().min(1, "Please enter the patient’s name.").max(100, "Use 100 characters or fewer."),
  age: z
    .string()
    .trim()
    .min(1, "Please enter the age.")
    .regex(/^\d{1,3}$/, "Enter whole years, 0 to 120.")
    .refine((value) => Number(value) <= 120, "Enter whole years, 0 to 120."),
  gender: z.enum(["male", "female", "other"], "Please choose the patient’s gender."),
  email: z
    .string()
    .trim()
    .max(150, "Use 150 characters or fewer.")
    .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email, or leave it empty."),
});

type FormValues = z.input<typeof schema>;
type FieldName = keyof FormValues;

// The values ready for the API: age as a number, an empty email as null.
export interface PatientDetails {
  fullName: string;
  age: number;
  gender: Gender;
  email: string | null;
}

const FIELDS: FieldName[] = ["fullName", "age", "gender", "email"];

function toFormValues(patient?: ClinicalPatient): FormValues {
  return {
    fullName: patient?.fullName ?? "",
    age: patient ? String(patient.age) : "",
    gender: patient?.gender ?? ("" as Gender),
    email: patient?.email ?? "",
  };
}

// VALIDATION_ERROR messages start with the field name, for example "age: Too big".
function serverFieldError(err: ApiError): { field: FieldName; message: string } | null {
  if (err.code !== "VALIDATION_ERROR") return null;
  const match = /^(\w+): (.+)$/.exec(err.message);
  const field = match?.[1] as FieldName | undefined;
  if (!match || !field || !FIELDS.includes(field)) return null;
  const text = match[2].replace(/\.?$/, ".");
  return { field, message: `${text[0].toUpperCase()}${text.slice(1)}` };
}

interface PatientFormProps {
  // The saved patient when editing; empty fields for a new patient.
  patient?: ClinicalPatient;
  submitLabel: string;
  busyLabel: string;
  submitIcon?: React.ReactNode;
  // Keeps the button busy after a successful submit, for example while the next page opens.
  busy?: boolean;
  // Gets only the fields that changed when editing, all fields for a new patient.
  // Throw an ApiError to show it next to its field or as a toast.
  onSubmit: (details: Partial<PatientDetails>) => Promise<void>;
  onCancel?: () => void;
}

export function PatientForm({ patient, submitLabel, busyLabel, submitIcon, busy = false, onSubmit, onCancel }: PatientFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, dirtyFields, isSubmitting: submitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: toFormValues(patient) });
  const isSubmitting = submitting || busy;

  async function submit(values: FormValues) {
    const details: PatientDetails = {
      fullName: values.fullName.trim(),
      age: Number(values.age),
      gender: values.gender as Gender,
      email: values.email.trim() === "" ? null : values.email.trim().toLowerCase(),
    };
    // When editing, send only the fields that changed (design doc 5.5, PATCH).
    const body: Partial<PatientDetails> = patient
      ? Object.fromEntries(FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, details[field]]))
      : details;

    try {
      await onSubmit(body);
    } catch (err) {
      const fieldError = err instanceof ApiError ? serverFieldError(err) : null;
      if (fieldError) {
        setError(fieldError.field, { type: "server", message: fieldError.message });
        if (fieldError.field !== "gender") setFocus(fieldError.field);
      } else {
        toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-5">
      <FormField id="fullName" label="Full name" error={errors.fullName?.message}>
        <Input
          id="fullName"
          dir="auto"
          autoComplete="off"
          placeholder="Patient’s full name"
          aria-invalid={!!errors.fullName}
          aria-describedby={describedBy("fullName")}
          {...register("fullName")}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <FormField id="age" label="Age" error={errors.age?.message}>
          <Input
            id="age"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0–120"
            maxLength={3}
            className="tabular-nums"
            aria-invalid={!!errors.age}
            aria-describedby={describedBy("age")}
            {...register("age")}
          />
        </FormField>

        <div className="space-y-2">
          <p id="gender-label" className="text-sm leading-none font-medium select-none">
            Gender
          </p>
          <div
            role="radiogroup"
            aria-labelledby="gender-label"
            aria-describedby="gender-error"
            aria-invalid={!!errors.gender}
            className="grid grid-cols-3 gap-2"
          >
            {GENDERS.map(({ value, label }) => (
              <label key={value} className="relative">
                <input type="radio" value={value} className="peer sr-only" {...register("gender")} />
                <span
                  className={cn(
                    "flex h-12 cursor-pointer items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors select-none hover:border-foreground/25 dark:bg-input/30",
                    "peer-checked:border-primary peer-checked:bg-mint peer-checked:font-semibold peer-checked:text-mint-foreground",
                    "peer-focus-visible:ring-4 peer-focus-visible:ring-primary/15",
                    errors.gender && "border-destructive",
                  )}
                >
                  {label}
                </span>
              </label>
            ))}
          </div>
          <FormError id="gender-error" message={errors.gender?.message} />
        </div>
      </div>

      <FormField
        id="email"
        label="Email (optional)"
        error={errors.email?.message}
        hint="For the prescription and the follow-up reminder. Without it, the prescription is sent by WhatsApp only."
      >
        <Input
          id="email"
          type="email"
          dir="ltr"
          inputMode="email"
          autoComplete="off"
          placeholder="patient@example.com"
          aria-invalid={!!errors.email}
          aria-describedby={describedBy("email")}
          {...register("email")}
        />
      </FormField>

      <div className={cn("flex flex-col-reverse gap-3", onCancel && "sm:flex-row")}>
        {onCancel && (
          <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={isSubmitting} className="sm:flex-1">
            Cancel
          </Button>
        )}
        <Button type="submit" size="lg" disabled={isSubmitting} className={cn("w-full", onCancel && "sm:w-auto sm:flex-2")}>
          {isSubmitting ? <Spinner className="size-4 text-current" label={busyLabel} /> : null}
          {isSubmitting ? busyLabel : submitLabel}
          {!isSubmitting && submitIcon}
        </Button>
      </div>
    </form>
  );
}
