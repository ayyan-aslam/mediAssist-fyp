import { FormError } from "@/components/shared/form-error";
import { Label } from "@/components/ui/label";

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  // Help text under the field, for example a live rule checklist.
  hint?: React.ReactNode;
  // Extra element on the label line, for example a "Forgot password?" link.
  labelAside?: React.ReactNode;
  children: React.ReactNode;
}

// Label, input, help text and error text. The input should use aria-describedby={describedBy(id)}.
export function FormField({ id, label, error, hint, labelAside, children }: FormFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
      </div>
      {children}
      {hint && (
        <div id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </div>
      )}
      <FormError id={`${id}-error`} message={error} />
    </div>
  );
}

export function describedBy(id: string) {
  return `${id}-hint ${id}-error`;
}
