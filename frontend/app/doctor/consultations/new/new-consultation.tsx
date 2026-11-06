"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Mail, Mic, Pencil, RotateCw, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { describedBy, FormField } from "@/components/shared/form-field";
import { PageTransition } from "@/components/shared/page-transition";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError } from "@/lib/api/client";
import { consultationsApi, patientByPhoneQueryKey } from "@/lib/api/consultations";
import type { ClinicalPatient, CreateClinicalPatientRequest, FindClinicalPatientResponse } from "@/lib/api/types";
import { normalizePkPhone, PK_PHONE_EXAMPLE } from "@/lib/phone";
import { PatientForm, type PatientDetails } from "./patient-form";

const LOOKUP_DELAY_MS = 400;
const GENDER_LABEL = { male: "Male", female: "Female", other: "Other" } as const;

// Soft fade and rise between the steps. Reduced motion is handled by MotionConfig.
const step = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.22, ease: "easeOut" },
} as const;

export function NewConsultation() {
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneServerError, setPhoneServerError] = useState<string | null>(null);

  const phone = normalizePkPhone(phoneInput);
  const lookupPhone = useDebouncedValue(phone, LOOKUP_DELAY_MS);
  const settled = phone !== null && phone === lookupPhone;

  const lookup = useQuery({
    queryKey: patientByPhoneQueryKey(lookupPhone ?? ""),
    queryFn: () => consultationsApi.findPatientByPhone(lookupPhone!),
    enabled: lookupPhone !== null,
    staleTime: 30_000,
  });

  const checking = phone !== null && (!settled || lookup.isFetching);
  const phoneError =
    phoneServerError ??
    (phoneTouched && phoneInput.trim() !== "" && phone === null
      ? `Enter a Pakistani mobile number, for example ${PK_PHONE_EXAMPLE}.`
      : undefined);

  // Which step to show under the phone field.
  let view: "idle" | "loading" | "error" | "found" | "new" = "idle";
  if (settled) {
    if (lookup.isPending) view = "loading";
    else if (lookup.isError) view = "error";
    else view = lookup.data.found ? "found" : "new";
  }

  return (
    <PageTransition className="mx-auto w-full max-w-xl space-y-8">
      <div className="space-y-2 sm:text-center">
        <p className="text-sm font-semibold text-primary">Patient details</p>
        <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[2.25rem]">
          New consultation
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          Start with the patient’s phone number. Saved details load by themselves.
        </p>
      </div>

      <div className="rounded-[1.5rem] border bg-card p-5 sm:p-8">
        <FormField
          id="patientPhone"
          label="Patient’s phone number"
          error={phoneError}
          hint={`For example ${PK_PHONE_EXAMPLE}`}
        >
          <div className="relative">
            <Input
              id="patientPhone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              autoFocus
              placeholder={PK_PHONE_EXAMPLE}
              value={phoneInput}
              onChange={(event) => {
                setPhoneInput(event.target.value);
                setPhoneServerError(null);
              }}
              onBlur={() => setPhoneTouched(true)}
              className="h-14 pr-12 text-lg tabular-nums md:text-lg"
              aria-invalid={!!phoneError}
              aria-describedby={describedBy("patientPhone")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
              {checking ? (
                <Spinner className="size-5" label="Checking the phone number" />
              ) : view === "found" ? (
                <CircleCheck aria-hidden="true" className="size-5 text-primary" />
              ) : null}
            </span>
          </div>
        </FormField>

        <AnimatePresence mode="wait" initial={false}>
          {view === "loading" && (
            <motion.div key="loading" {...step} className="mt-6 space-y-3" aria-busy="true">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-13 w-full rounded-lg" />
            </motion.div>
          )}

          {view === "error" && (
            <motion.div key="error" {...step} className="mt-6 space-y-4">
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>The patient could not be checked. {lookup.error?.message}</AlertDescription>
              </Alert>
              <Button variant="outline" onClick={() => lookup.refetch()} disabled={lookup.isFetching}>
                {lookup.isFetching ? <Spinner className="size-4 text-current" label="Checking" /> : <RotateCw aria-hidden="true" />}
                Try again
              </Button>
            </motion.div>
          )}

          {view === "found" && lookup.data?.found && (
            <motion.div key={`found-${lookup.data.patient.clinicalPatientId}`} {...step} className="mt-6">
              <SavedPatient patient={lookup.data.patient} />
            </motion.div>
          )}

          {view === "new" && phone && (
            <motion.div key={`new-${phone}`} {...step} className="mt-6">
              <NewPatient phone={phone} onPhoneTaken={setPhoneServerError} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}

// Starts the consultation and opens the recording page. The button stays busy until the page changes.
function useStartConsultation() {
  const router = useRouter();
  return useMutation({
    mutationFn: consultationsApi.start,
    onSuccess: ({ consultationId }) => router.push(`/doctor/consultations/${consultationId}/record`),
    onError: (err) => toast.error(`The recording could not be started. ${err.message}`),
  });
}

function StartButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <Button size="lg" onClick={onClick} disabled={busy} className="w-full">
      {busy ? <Spinner className="size-4 text-current" label="Starting" /> : <Mic aria-hidden="true" data-icon="inline-start" />}
      {busy ? "Starting…" : "Start recording"}
    </Button>
  );
}

function SavedPatient({ patient }: { patient: ClinicalPatient }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const start = useStartConsultation();
  const starting = start.isPending || start.isSuccess;

  async function save(changes: Partial<PatientDetails>) {
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    try {
      const updated = await consultationsApi.updatePatient(patient.clinicalPatientId, changes);
      queryClient.setQueryData<FindClinicalPatientResponse>(patientByPhoneQueryKey(updated.phone), {
        found: true,
        patient: updated,
      });
      setEditing(false);
      toast.success("The patient’s details are saved.");
    } catch (err) {
      // The patient was removed or belongs to someone else: check the phone again.
      if (err instanceof ApiError && err.code === "PATIENT_NOT_FOUND") {
        await queryClient.invalidateQueries({ queryKey: patientByPhoneQueryKey(patient.phone) });
      }
      throw err;
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {editing ? (
        <motion.div key="edit" {...step} className="space-y-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Pencil aria-hidden="true" className="size-4" />
            Edit the patient’s details
          </p>
          <PatientForm
            patient={patient}
            submitLabel="Save details"
            busyLabel="Saving…"
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        </motion.div>
      ) : (
        <motion.div key="card" {...step} className="space-y-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            <CircleCheck aria-hidden="true" className="size-4" />
            Saved patient
          </p>

          <div className="rounded-2xl bg-mint p-5 text-mint-foreground sm:p-6">
            <div className="flex items-start gap-3 sm:gap-4">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-current/10 font-display text-base font-bold sm:size-12 sm:text-lg"
              >
                {initials(patient.fullName)}
              </span>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-display text-xl font-bold tracking-tight">
                  {patient.fullName}
                </p>
                <p className="mt-0.5 whitespace-nowrap opacity-80">
                  <span className="tabular-nums">{patient.age}</span> years · {GENDER_LABEL[patient.gender]}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={starting}
                className="-mt-1 -mr-2 shrink-0 text-current hover:bg-current/10 hover:text-current"
              >
                <Pencil aria-hidden="true" data-icon="inline-start" />
                Edit
              </Button>
            </div>
            <p className="mt-4 flex min-w-0 items-center gap-2 border-t border-current/10 pt-4 text-sm">
              <Mail aria-hidden="true" className="size-4 shrink-0 opacity-80" />
              {patient.email ? (
                <span dir="ltr" className="truncate">
                  {patient.email}
                </span>
              ) : (
                <span className="opacity-80">No email. The prescription can be sent by WhatsApp only.</span>
              )}
            </p>
          </div>

          <StartButton busy={starting} onClick={() => start.mutate(patient.clinicalPatientId)} />
          <p className="text-center text-sm text-muted-foreground">English, Urdu and Punjabi. Up to 30 minutes.</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NewPatient({ phone, onPhoneTaken }: { phone: string; onPhoneTaken: (message: string) => void }) {
  const queryClient = useQueryClient();
  const start = useStartConsultation();

  // One click: save the patient, then start the consultation.
  async function saveAndStart(details: Partial<PatientDetails>) {
    let patient: ClinicalPatient;
    try {
      patient = await consultationsApi.createPatient({ ...(details as PatientDetails), phone } satisfies CreateClinicalPatientRequest);
    } catch (err) {
      // Saved meanwhile (for example in another tab): show it under the phone and load the saved details.
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_SAVED") {
        onPhoneTaken(`${err.message} Its details are shown below.`);
        await queryClient.invalidateQueries({ queryKey: patientByPhoneQueryKey(phone) });
        return;
      }
      throw err;
    }

    try {
      await start.mutateAsync(patient.clinicalPatientId);
      // The page changes now. The saved lookup is out of date, so it is checked again next time.
      await queryClient.invalidateQueries({ queryKey: patientByPhoneQueryKey(phone), refetchType: "none" });
    } catch {
      // The patient is saved, but the recording did not start (a toast says why).
      // Show the saved patient card, so "Start recording" can be pressed again.
      queryClient.setQueryData<FindClinicalPatientResponse>(patientByPhoneQueryKey(phone), { found: true, patient });
    }
  }

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-primary">
        <UserRoundPlus aria-hidden="true" className="size-4" />
        New patient. Add their details to start
      </p>
      <PatientForm
        submitLabel="Save & start recording"
        busyLabel="Starting…"
        submitIcon={<Mic aria-hidden="true" data-icon="inline-end" />}
        busy={start.isSuccess}
        onSubmit={saveAndStart}
      />
      <p className="text-center text-sm text-muted-foreground">English, Urdu and Punjabi. Up to 30 minutes.</p>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
}
