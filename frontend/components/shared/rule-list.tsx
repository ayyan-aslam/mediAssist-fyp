import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

// Live checklist under a field, for example the password rules. Each rule turns green when met.
export function RuleList({ rules, className }: { rules: { label: string; met: boolean }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs", className)}>
      {rules.map(({ label, met }) => (
        <li
          key={label}
          className={cn(
            "flex items-center gap-1.5 transition-colors",
            met ? "text-success" : "text-muted-foreground",
          )}
        >
          {met ? (
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          ) : (
            <Circle aria-hidden="true" className="size-3" />
          )}
          {label}
          <span className="sr-only">{met ? "(done)" : "(not yet)"}</span>
        </li>
      ))}
    </ul>
  );
}
