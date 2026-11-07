"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { describedBy, FormField } from "@/components/shared/form-field";
import { PageTransition } from "@/components/shared/page-transition";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api/client";
import type { DoctorProfile, UpdateDoctorProfileRequest } from "@/lib/api/types";
import { PROFILE_QUERY_KEY, SPECIALTIES_QUERY_KEY, usersApi } from "@/lib/api/users";
import { normalizePkPhone, PK_PHONE_EXAMPLE, pkPhoneSchema } from "@/lib/phone";

// Same limits as the Auth & User Service (USERS.full_name is VARCHAR(100)).
const schema = z.object({
  fullName: z.string().trim().min(1, "Please enter your full name.").max(100, "Use 100 characters or fewer."),
  phone: pkPhoneSchema,
  specialtyId: z.number().int().positive().nullable(),
});

type Values = z.infer<typeof schema>;
type FieldName = keyof Values;

const FIELDS: FieldName[] = ["fullName", "phone", "specialtyId"];

function toValues(profile: DoctorProfile): Values {
  return { fullName: profile.fullName, phone: profile.phone ?? "", specialtyId: profile.specialty?.specialtyId ?? null };
}

// PHONE_TAKEN goes under the phone field. VALIDATION_ERROR messages start with the field name,
// for example "specialtyId: this speciality does not exist.".
function serverFieldError(err: ApiError): { field: FieldName; message: string } | null {
  if (err.code === "PHONE_TAKEN") return { field: "phone", message: `${err.message} Please enter another number.` };
  if (err.code !== "VALIDATION_ERROR") return null;
  const match = /^(\w+): (.+)$/.exec(err.message);
  const field = match?.[1] as FieldName | undefined;
  if (!match || !field || !FIELDS.includes(field)) return null;
  const text = match[2].replace(/\.?$/, ".");
  return { field, message: `${text[0].toUpperCase()}${text.slice(1)}` };
}

export function ProfileView() {
  const profile = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: usersApi.getMe });

  return (
    <PageTransition className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[2.25rem]">
          Your profile
        </h1>
        <p className="leading-relaxed text-muted-foreground">Keep your name, phone number and speciality up to date.</p>
      </div>

      <div className="max-w-2xl rounded-[1.5rem] border bg-card p-6 sm:p-8">
        {profile.isPending ? (
          <ProfileSkeleton />
        ) : profile.isError ? (
          <div className="space-y-5">
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>
                Your profile could not be loaded. {profile.error.message}
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => profile.refetch()} disabled={profile.isFetching}>
              {profile.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
              Try again
            </Button>
          </div>
        ) : (
          <ProfileForm profile={profile.data} />
        )}
      </div>
    </PageTransition>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your profile" className="space-y-5">
      {[0, 1].map((row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ))}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {[0, 1].map((col) => (
          <div key={col} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <Skeleton className="h-13 w-full rounded-lg" />
    </div>
  );
}

function ProfileForm({ profile }: { profile: DoctorProfile }) {
  const queryClient = useQueryClient();
  const { updateUser } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const specialties = useQuery({
    queryKey: SPECIALTIES_QUERY_KEY,
    queryFn: usersApi.listSpecialties,
    select: (data) => data.items,
    staleTime: Infinity,
  });
  // Until the list arrives (or if it fails), the current speciality can still be shown.
  const options = (specialties.data ?? (profile.specialty ? [profile.specialty] : [])).map((item) => ({
    value: item.specialtyId,
    label: item.name,
  }));

  const save = useMutation({
    mutationFn: usersApi.updateMe,
    onSuccess: (updated) => queryClient.setQueryData(PROFILE_QUERY_KEY, updated),
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, dirtyFields, isDirty, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: toValues(profile) });

  async function onSubmit(values: Values) {
    setFormError(null);
    // Send only the fields that changed (design doc 5.2, PATCH /users/me).
    const body: UpdateDoctorProfileRequest = {};
    if (dirtyFields.fullName) body.fullName = values.fullName.trim();
    if (dirtyFields.phone) body.phone = normalizePkPhone(values.phone) ?? values.phone;
    if (dirtyFields.specialtyId) body.specialtyId = values.specialtyId;

    try {
      const updated = await save.mutateAsync(body);
      reset(toValues(updated));
      updateUser({ fullName: updated.fullName });
      toast.success("Your profile is saved.");
    } catch (err) {
      const fieldError = err instanceof ApiError ? serverFieldError(err) : null;
      if (fieldError) {
        setError(fieldError.field, { type: "server", message: fieldError.message });
        if (fieldError.field !== "specialtyId") setFocus(fieldError.field);
      } else {
        setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    }
  }

  const specialtyHint = specialties.isError ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>The list of specialities could not be loaded.</span>
      <button
        type="button"
        onClick={() => specialties.refetch()}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        Try again
      </button>
    </span>
  ) : undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      {formError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <FormField id="fullName" label="Full name" error={errors.fullName?.message}>
        <Input
          id="fullName"
          dir="auto"
          autoComplete="name"
          aria-invalid={!!errors.fullName}
          aria-describedby={describedBy("fullName")}
          {...register("fullName")}
        />
      </FormField>

      <FormField id="email" label="Email" hint="You log in with this email. It cannot be changed.">
        <Input
          id="email"
          type="email"
          value={profile.email}
          readOnly
          aria-describedby={describedBy("email")}
          className="bg-muted text-muted-foreground hover:border-input focus-visible:border-input focus-visible:ring-0 dark:bg-muted"
        />
      </FormField>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField id="phone" label="Phone number" error={errors.phone?.message} hint={`For example ${PK_PHONE_EXAMPLE}`}>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={PK_PHONE_EXAMPLE}
            aria-invalid={!!errors.phone}
            aria-describedby={describedBy("phone")}
            {...register("phone")}
          />
        </FormField>

        <FormField id="specialtyId" label="Speciality" error={errors.specialtyId?.message} hint={specialtyHint}>
          {specialties.isPending && !profile.specialty ? (
            <Skeleton className="h-12 w-full rounded-lg" />
          ) : (
            <Controller
              control={control}
              name="specialtyId"
              render={({ field }) => (
                <SearchableSelect
                  id="specialtyId"
                  options={options}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Choose your speciality"
                  searchLabel="Search specialities"
                  emptyText={specialties.isPending ? "Loading specialities…" : "No speciality matches your search."}
                  aria-invalid={!!errors.specialtyId}
                  aria-describedby={describedBy("specialtyId")}
                />
              )}
            />
          )}
        </FormField>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={!isDirty || isSubmitting}>
        {isSubmitting && <Spinner className="size-4 text-current" label="Saving" />}
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
      {!isDirty && !isSubmitting && (
        <p className="text-center text-sm text-muted-foreground">Change a field to save it.</p>
      )}
    </form>
  );
}
