import type { LucideIcon } from "lucide-react";

// Title block at the top of each auth page.
export function AuthHeading({
  icon: Icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 space-y-3">
      {Icon && (
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-mint text-mint-foreground">
          <Icon aria-hidden="true" className="size-6" />
        </div>
      )}
      <h1 className="font-display text-[2rem] leading-[1.1] font-extrabold tracking-[-0.03em] sm:text-[2.25rem]">{title}</h1>
      {children && <div className="text-[1.0625rem] leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}
