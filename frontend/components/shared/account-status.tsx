import type { AccountStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const CHIP: Record<AccountStatus, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-secondary text-secondary-foreground" },
  suspended: { label: "Suspended", tone: "bg-rec/10 text-rec" },
};

export function AccountStatusChip({ status, className }: { status: AccountStatus; className?: string }) {
  const { label, tone } = CHIP[status];
  return (
    <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone, className)}>
      {label}
    </span>
  );
}
