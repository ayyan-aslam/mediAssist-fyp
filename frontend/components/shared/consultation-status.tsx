import type { ConsultationStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const CHIP: Record<ConsultationStatus, { label: string; tone: string }> = {
  completed: { label: "Note ready", tone: "bg-secondary text-secondary-foreground" },
  processing: { label: "Processing", tone: "bg-peach text-peach-foreground" },
  recording: { label: "Recording", tone: "bg-rec/10 text-rec" },
  failed: { label: "Failed", tone: "bg-rec/10 text-rec" },
};

export function ConsultationStatusChip({ status, className }: { status: ConsultationStatus; className?: string }) {
  const { label, tone } = CHIP[status];
  return (
    <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone, className)}>
      {label}
    </span>
  );
}

// Where a consultation opens: the note when it is ready, otherwise the page that shows where it is.
export function consultationHref(consultationId: number, status: ConsultationStatus) {
  if (status === "completed") return `/doctor/consultations/${consultationId}/note`;
  if (status === "recording") return `/doctor/consultations/${consultationId}/record`;
  return `/doctor/consultations/${consultationId}/processing`;
}
