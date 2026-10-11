import { cn } from "@/lib/utils";

// Logo mark: a medical cross whose right arm becomes sound bars (the app listens to the consultation).
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <rect x="12" y="7.5" width="4.5" height="17" rx="1.4" className="fill-primary-foreground" />
      <rect x="6.5" y="13.75" width="13" height="4.5" rx="1.4" className="fill-primary-foreground" />
      <rect x="21" y="12.5" width="2.25" height="7" rx="1.1" className="fill-primary-foreground/85" />
      <rect x="24.75" y="10" width="2.25" height="12" rx="1.1" className="fill-primary-foreground/60" />
    </svg>
  );
}

// tone "navy": for navy backgrounds (footer, brand panels).
export function Logo({ className, tone = "default" }: { className?: string; tone?: "default" | "navy" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span
        className={cn(
          "font-display text-[1.05rem] font-extrabold tracking-[-0.02em] whitespace-nowrap",
          tone === "navy" ? "text-navy-foreground" : "text-foreground",
        )}
      >
        MediAssist <span className={tone === "navy" ? "text-brand-bright" : "text-primary"}>AI</span>
      </span>
    </span>
  );
}
