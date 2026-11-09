"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileCheck2,
  FileDown,
  Loader2,
  Lock,
  Mail,
  MailX,
  MessageCircle,
  RotateCw,
  Send,
  Sparkles,
  TriangleAlert,
  UserRoundPen,
} from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrescription } from "@/hooks/use-prescription";
import { ApiError } from "@/lib/api/client";
import { deliveriesQueryKey, prescriptionQueryKey, prescriptionsApi, sendOptionsQueryKey } from "@/lib/api/prescriptions";
import type { AiMedicine, Consultation, Delivery, Prescription, PrescriptionItem } from "@/lib/api/types";
import { pdfFileName, saveFile } from "@/lib/download";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Cell, SectionHeader, sectionClass } from "./ai-insights";

// After sending, the deliveries are checked every 2 seconds for at most 60 seconds (design doc 5.7).
const POLL_EVERY_MS = 2_000;
const POLL_FOR_MS = 60_000;

const FINALIZE_ERRORS: Record<string, string> = {
  PRESCRIPTION_EMPTY: "The prescription has no medicines. Add at least one medicine to the prescription above, then finalize.",
  SOAP_NOT_READY: "The SOAP note is not ready yet, so the prescription cannot be finalized.",
};

// Below the AI insights: finalize the prescription, then download it and send it to the patient
// (design doc Diagrams 8 and 9).
export function PrescriptionPanel({
  consultation,
  medicines,
  editing,
  beforeFinalize,
}: {
  consultation: Consultation;
  // The saved prescription shown above (the doctor's edits, or the AI's medicines).
  medicines: AiMedicine[];
  // true while the prescription editor above is open with changes that are not saved.
  editing: boolean;
  // Saves the note first, so the notes on the prescription are what is on the screen.
  beforeFinalize: () => Promise<boolean>;
}) {
  const prescription = usePrescription(consultation.consultationId);

  if (prescription.isPending) {
    return (
      <div className={sectionClass} aria-busy="true" aria-label="Loading the prescription">
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full max-w-sm" />
          </div>
        </div>
        <Skeleton className="mt-5 h-11 w-52 rounded-lg" />
      </div>
    );
  }

  if (prescription.isError) {
    return (
      <section aria-label="Prescription" className={sectionClass}>
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The prescription could not be loaded. {prescription.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => prescription.refetch()} disabled={prescription.isFetching}>
          {prescription.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </section>
    );
  }

  if (prescription.data === null) {
    return (
      <FinalizeSection consultationId={consultation.consultationId} medicines={medicines} editing={editing} beforeFinalize={beforeFinalize} />
    );
  }

  return <FinalPrescription consultation={consultation} prescription={prescription.data} />;
}

// ---------------------------------------------------------------- before finalizing
function FinalizeSection({
  consultationId,
  medicines,
  editing,
  beforeFinalize,
}: {
  consultationId: number;
  medicines: AiMedicine[];
  editing: boolean;
  beforeFinalize: () => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const finalize = useMutation({
    mutationFn: async () => {
      if (!(await beforeFinalize())) {
        throw new ApiError(0, "NOTE_NOT_SAVED", "The SOAP note could not be saved. Check your internet connection and try again.");
      }
      return prescriptionsApi.finalize(consultationId);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(prescriptionQueryKey(consultationId), saved);
      setOpen(false);
      toast.success("Prescription finalized");
    },
    onError: (err) => {
      // Finalized already (another tab, or a double click): show the saved one.
      if (err instanceof ApiError && err.code === "PRESCRIPTION_EXISTS") {
        setOpen(false);
        toast.info("This prescription was already finalized.");
        void queryClient.invalidateQueries({ queryKey: prescriptionQueryKey(consultationId) });
      }
    },
  });

  const error = finalize.error;
  const errorText = error instanceof ApiError ? (FINALIZE_ERRORS[error.code] ?? error.message) : error?.message;
  const named = medicines.filter((m) => m.name || m.genericName);

  return (
    <section aria-labelledby="final-prescription-title" className={sectionClass}>
      <SectionHeader
        id="final-prescription-title"
        icon={FileCheck2}
        title="Finalize the prescription"
        hint="When the prescription above is ready, finalize it. Then you can download it as a PDF and send it to the patient."
        tone="bg-mint text-mint-foreground"
      />
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          size="lg"
          onClick={() => {
            finalize.reset();
            setOpen(true);
          }}
          disabled={editing}
          aria-describedby={editing ? "finalize-hint" : undefined}
          className="w-full sm:w-auto"
        >
          <Lock aria-hidden="true" data-icon="inline-start" />
          Finalize prescription
        </Button>
        {editing && (
          <p id="finalize-hint" className="text-sm text-muted-foreground">
            Save or cancel your changes to the prescription first.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => !finalize.isPending && setOpen(next)}>
        <DialogContent showCloseButton={!finalize.isPending}>
          <DialogHeader>
            <DialogTitle>Finalize the prescription?</DialogTitle>
            <DialogDescription>
              {named.length === 0
                ? "There are no medicines on the prescription."
                : `${named.length === 1 ? "This medicine goes" : `These ${named.length} medicines go`} on the prescription. The plan from the SOAP note is added as notes.`}
            </DialogDescription>
          </DialogHeader>

          {named.length > 0 ? (
            <ol className="divide-y rounded-2xl border">
              {named.map((m, index) => (
                <li key={index} className="flex gap-3 px-4 py-3">
                  <span className="font-display font-bold text-muted-foreground tabular-nums">{index + 1}</span>
                  <div className="min-w-0">
                    <p dir="auto" className="font-semibold wrap-break-word">
                      {m.name ?? m.genericName}
                    </p>
                    <p dir="auto" className="text-sm wrap-break-word text-muted-foreground">
                      {/* Only the dose is saved on the prescription, not the strength. */}
                      {[m.dose ?? (m.strength && `No dose (strength ${m.strength})`), m.frequency, m.duration].filter(Boolean).join(" · ") ||
                        "No dose written"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-2xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
              Close this and add the medicines to the prescription above first.
            </p>
          )}

          <Alert className="border-highlight/60 bg-peach text-peach-foreground *:[svg]:text-peach-foreground">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>A final prescription cannot be changed</AlertTitle>
            <AlertDescription className="text-peach-foreground/90">
              Check the medicines and doses before you finalize.
            </AlertDescription>
          </Alert>

          {errorText && !(error instanceof ApiError && error.code === "PRESCRIPTION_EXISTS") && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={finalize.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={() => finalize.mutate()} disabled={finalize.isPending || named.length === 0}>
              {finalize.isPending ? <Spinner className="size-4 text-current" label="Finalizing" /> : <Lock aria-hidden="true" data-icon="inline-start" />}
              {finalize.isPending ? "Finalizing…" : "Finalize prescription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------- after finalizing
function FinalPrescription({ consultation, prescription }: { consultation: Consultation; prescription: Prescription }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const pdf = await prescriptionsApi.downloadPdf(prescription.prescriptionId);
      saveFile(pdf, pdfFileName("Prescription", prescription.patientName, prescription.createdAt));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The PDF could not be downloaded. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const downloadButton = (
    <Button variant="outline" onClick={download} disabled={downloading}>
      {downloading ? <Spinner className="size-4 text-current" label="Downloading" /> : <FileDown aria-hidden="true" data-icon="inline-start" />}
      {downloading ? "Downloading…" : "Download PDF"}
    </Button>
  );

  return (
    <section aria-labelledby="final-prescription-title" className={sectionClass}>
      <SectionHeader
        id="final-prescription-title"
        icon={FileCheck2}
        title="Final prescription"
        hint={`Finalized on ${formatDate(prescription.createdAt)}. It cannot be changed.`}
        tone="bg-mint text-mint-foreground"
      />

      <div className="mt-5 overflow-hidden rounded-2xl border">
        <div className="hidden grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-4 bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground sm:grid">
          <span>Medicine</span>
          <span>Dose</span>
          <span>How often</span>
          <span>How long</span>
        </div>
        <ul className="divide-y">
          {prescription.items.map((item) => (
            <FinalItem key={item.itemId} item={item} />
          ))}
        </ul>
      </div>

      {prescription.notes && (
        <div className="mt-4 rounded-2xl bg-muted/60 px-4 py-3">
          <p className="text-sm font-semibold text-muted-foreground">Notes</p>
          <p dir="auto" className="mt-1 text-sm leading-relaxed wrap-break-word whitespace-pre-line">
            {prescription.notes}
          </p>
        </div>
      )}

      <div className="mt-4">{downloadButton}</div>

      <SendToPatient
        prescriptionId={prescription.prescriptionId}
        consultation={consultation}
        downloadButton={downloadButton}
      />
    </section>
  );
}

function FinalItem({ item }: { item: PrescriptionItem }) {
  return (
    <li className="px-4 py-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] sm:items-start">
        <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
          <p dir="auto" className="font-semibold wrap-break-word">
            <span className="mr-1.5 text-muted-foreground tabular-nums">{item.position}.</span>
            {item.medicineName}
          </p>
          {item.genericName && item.genericName !== item.medicineName && (
            <p dir="auto" className="text-sm wrap-break-word text-muted-foreground">
              {item.genericName}
            </p>
          )}
          {item.source === "ai_accepted" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-peach px-2 py-0.5 text-[11px] font-semibold text-peach-foreground">
              <Sparkles aria-hidden="true" className="size-3" />
              Accepted AI suggestion
            </span>
          )}
          {item.source === "doctor_added" && <p className="text-xs font-medium text-muted-foreground">Added by the doctor</p>}
        </div>
        <Cell label="Dose" value={item.dose} />
        <Cell label="How often" value={item.frequency} />
        <Cell label="How long" value={item.duration} />
        {item.instructions && (
          <p dir="auto" className="col-span-2 text-sm text-muted-foreground sm:col-span-4">
            {item.instructions}
          </p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- sending
function SendToPatient({
  prescriptionId,
  consultation,
  downloadButton,
}: {
  prescriptionId: number;
  consultation: Consultation;
  downloadButton: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  // Checking stops 60 seconds after the page opened or after the last send.
  const [polling, setPolling] = useState(true);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const startPolling = () => {
    setPolling(true);
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => setPolling(false), POLL_FOR_MS);
  };

  useEffect(() => {
    stopTimer.current = setTimeout(() => setPolling(false), POLL_FOR_MS);
    return () => clearTimeout(stopTimer.current);
  }, []);

  const options = useQuery({
    queryKey: sendOptionsQueryKey(prescriptionId),
    queryFn: () => prescriptionsApi.getSendOptions(prescriptionId),
  });

  const deliveries = useQuery({
    queryKey: deliveriesQueryKey(prescriptionId),
    queryFn: () => prescriptionsApi.listDeliveries(prescriptionId),
    refetchInterval: (query) => (polling && query.state.data?.items[0]?.status === "sending" ? POLL_EVERY_MS : false),
  });

  const send = useMutation({
    mutationFn: () => prescriptionsApi.sendByEmail(prescriptionId),
    onSuccess: () => {
      startPolling();
      void queryClient.invalidateQueries({ queryKey: deliveriesQueryKey(prescriptionId) });
    },
    onError: (err) => {
      // The email was removed from the patient after the options were loaded.
      if (err instanceof ApiError && err.code === "NO_EMAIL") {
        void queryClient.invalidateQueries({ queryKey: sendOptionsQueryKey(prescriptionId) });
      }
      toast.error(err instanceof ApiError ? err.message : "The prescription could not be sent. Please try again.");
    },
  });

  const newest = deliveries.data?.items[0];
  const busy = send.isPending || (newest?.status === "sending" && polling);
  const editPatientHref = `/doctor/patients/${consultation.patient.clinicalPatientId}?edit=1&note=${consultation.consultationId}`;

  let body: React.ReactNode;
  if (options.isPending) {
    body = (
      <div className="flex flex-col gap-3 sm:flex-row" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-13 w-full rounded-lg sm:w-64" />
        <Skeleton className="h-13 w-full rounded-lg sm:w-48" />
      </div>
    );
  } else if (options.isError) {
    body = (
      <>
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>The ways to send could not be loaded. {options.error.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-3" onClick={() => options.refetch()} disabled={options.isFetching}>
          {options.isFetching ? <Spinner className="size-4 text-current" label="Loading" /> : <RotateCw aria-hidden="true" />}
          Try again
        </Button>
      </>
    );
  } else {
    const { email, whatsapp } = options.data;
    body = (
      <div className="space-y-4">
        {email.available && email.recipient ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button size="lg" onClick={() => send.mutate()} disabled={busy} className="w-full min-w-0 sm:w-auto">
              {send.isPending ? <Spinner className="size-4 text-current" label="Sending" /> : <Mail aria-hidden="true" data-icon="inline-start" />}
              <span className="truncate">Email to {email.recipient}</span>
            </Button>
            <WhatsAppButton reason={whatsapp.reason} />
          </div>
        ) : (
          <>
            <Alert className="border-highlight/60 bg-peach text-peach-foreground *:[svg]:text-peach-foreground">
              <MailX aria-hidden="true" />
              <AlertTitle>This patient has no email address</AlertTitle>
              <AlertDescription className="text-peach-foreground/90">
                Add their email to send the prescription, or download the PDF and give it to the patient.
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild>
                <Link href={editPatientHref}>
                  <UserRoundPen aria-hidden="true" data-icon="inline-start" />
                  Add the patient’s email
                </Link>
              </Button>
              {downloadButton}
              <WhatsAppButton reason={whatsapp.reason} />
            </div>
          </>
        )}
        {newest && (
          <DeliveryLine
            delivery={newest}
            polling={polling}
            onCheckAgain={() => {
              startPolling();
              void deliveries.refetch();
            }}
          />
        )}
        {deliveries.isError && <p className="text-sm text-muted-foreground">The sending status could not be loaded.</p>}
      </div>
    );
  }

  return (
    <div className="mt-6 border-t pt-5">
      <h4 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
        <Send aria-hidden="true" className="size-5 text-primary" />
        Send to patient
      </h4>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">The patient gets an email with the prescription PDF attached.</p>
      {body}
    </div>
  );
}

function WhatsAppButton({ reason }: { reason: string }) {
  return (
    <Button variant="outline" size="lg" disabled className="w-full sm:w-auto">
      <MessageCircle aria-hidden="true" data-icon="inline-start" />
      WhatsApp
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{reason}</span>
    </Button>
  );
}

// The status of the newest send: "Sending…", "Sent" or "Failed – try again".
function DeliveryLine({ delivery, polling, onCheckAgain }: { delivery: Delivery; polling: boolean; onCheckAgain: () => void }) {
  let icon: React.ReactNode;
  let title: string;
  let detail: React.ReactNode = null;
  let tone = "bg-muted/60";

  if (delivery.status === "sent") {
    icon = <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-success" />;
    title = "Sent";
    detail = `To ${delivery.recipient}${delivery.completedAt ? ` at ${formatTime(delivery.completedAt)}` : ""}.`;
    tone = "bg-mint text-mint-foreground";
  } else if (delivery.status === "failed") {
    icon = <CircleX aria-hidden="true" className="size-5 shrink-0 text-destructive" />;
    title = "Failed – try again";
    detail = delivery.errorMessage ?? "The email could not be sent.";
  } else if (polling) {
    icon = <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-primary" />;
    title = "Sending…";
    detail = `To ${delivery.recipient}.`;
  } else {
    icon = <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />;
    title = "Still sending";
    detail = (
      <>
        This is taking longer than usual.{" "}
        <button type="button" onClick={onCheckAgain} className="font-semibold text-primary underline-offset-3 hover:underline">
          Check again
        </button>
      </>
    );
  }

  return (
    <div role="status" aria-live="polite" className={cn("flex items-start gap-3 rounded-2xl px-4 py-3", tone)}>
      {icon}
      <div className="min-w-0 text-sm">
        <p className={cn("font-semibold", delivery.status === "failed" && "text-destructive")}>{title}</p>
        <p className={cn("wrap-break-word", delivery.status === "sent" ? "opacity-90" : "text-muted-foreground")}>{detail}</p>
      </div>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
