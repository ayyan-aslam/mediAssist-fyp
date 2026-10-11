import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// Error text under a form field, or above a form for a server error.
export function FormError({ id, message, className }: { id?: string; message?: string; className?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={cn("flex items-start gap-1.5 text-sm text-destructive", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}
