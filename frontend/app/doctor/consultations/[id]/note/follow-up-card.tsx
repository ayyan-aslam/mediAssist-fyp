"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarClock, CalendarX, Check } from "lucide-react";
import { toast } from "sonner";
import { describedBy, FormField } from "@/components/shared/form-field";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import { consultationQueryKey, consultationsApi, patientQueryKey } from "@/lib/api/consultations";
import type { Consultation } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { SectionHeader, sectionClass } from "./ai-insights";

// Today as YYYY-MM-DD in the browser's time zone, the first date the picker allows.
function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Sets, changes or removes the follow-up date (design doc 5.5 and Diagram 10). Reminder emails go out
// at 9:00 AM the day before: always to the doctor, and to the patient when they have an email.
export function FollowUpCard({ consultation }: { consultation: Consultation }) {
  const queryClient = useQueryClient();
  const consultationId = consultation.consultationId;
  const saved = consultation.followUpDate;
  const [value, setValue] = useState(saved ?? "");
  // From the last save; before that, from the patient's saved email.
  const [patientReminder, setPatientReminder] = useState<boolean | null>(null);
  const [error, setError] = useState<string | undefined>();
  const min = today();

  const patient = useQuery({
    queryKey: patientQueryKey(consultation.patient.clinicalPatientId),
    queryFn: () => consultationsApi.getPatient(consultation.patient.clinicalPatientId),
  });
  const reachesPatient = patientReminder ?? (patient.data ? patient.data.email !== null : null);

  const save = useMutation({
    mutationFn: (followUpDate: string | null) => consultationsApi.setFollowUp(consultationId, followUpDate),
    onSuccess: (result) => {
      // The field first: the cache update below re-renders at once.
      setValue(result.followUpDate ?? "");
      setPatientReminder(result.patientReminder);
      setError(undefined);
      queryClient.setQueryData<Consultation>(consultationQueryKey(consultationId), (current) =>
        current ? { ...current, followUpDate: result.followUpDate } : current,
      );
      toast.success(result.followUpDate ? "Follow-up date saved" : "Follow-up removed");
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.code === "DATE_IN_PAST" || err.code === "VALIDATION_ERROR")) {
        setError(err.code === "DATE_IN_PAST" ? "Choose today or a later date." : "Choose a valid date.");
      } else {
        toast.error(err instanceof ApiError ? err.message : "The follow-up date could not be saved. Please try again.");
      }
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value) return setError("Choose a date.");
    if (value < min) return setError("Choose today or a later date.");
    save.mutate(value);
  };

  const pendingDate = save.isPending ? save.variables : undefined;

  return (
    <section aria-labelledby="follow-up-title" className={sectionClass}>
      <SectionHeader
        id="follow-up-title"
        icon={CalendarClock}
        title="Follow-up"
        hint={saved ? `Next visit on ${formatDate(saved)}.` : "Choose a date for the next visit. A reminder email goes out at 9:00 AM the day before."}
        tone="bg-sky text-sky-foreground"
      />

      <form onSubmit={submit} noValidate className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,16rem)_auto_auto] sm:items-start">
        <FormField id="followUpDate" label="Follow-up date" error={error}>
          <Input
            id="followUpDate"
            type="date"
            min={min}
            value={value}
            disabled={save.isPending}
            onChange={(event) => {
              setValue(event.target.value);
              setError(undefined);
            }}
            aria-invalid={!!error}
            aria-describedby={describedBy("followUpDate")}
            className="tabular-nums"
          />
        </FormField>
        <Button type="submit" disabled={save.isPending || !value || value === saved} className="sm:mt-7">
          {pendingDate ? <Spinner className="size-4 text-current" label="Saving" /> : <Check aria-hidden="true" data-icon="inline-start" />}
          {pendingDate ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <Button type="button" variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)} className="sm:mt-7">
            {pendingDate === null ? <Spinner className="size-4 text-current" label="Removing" /> : <CalendarX aria-hidden="true" data-icon="inline-start" />}
            {pendingDate === null ? "Removing…" : "Remove"}
          </Button>
        )}
      </form>

      {saved && reachesPatient !== null && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
          <BellRing aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          {reachesPatient
            ? "The patient will get a reminder email."
            : "Only you will get a reminder (patient has no email)."}
        </p>
      )}
    </section>
  );
}
