import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

// Shown inside a panel or card when there is nothing to list yet.
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-mint text-mint-foreground">
        <Icon aria-hidden="true" className="size-6" />
      </div>
      <h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
