import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  // What is listed, for "1–20 of 57 users".
  noun: string;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

// Previous and next buttons under a paged list (design doc 5.1.2).
export function Pager({ page, pageSize, total, noun, onPageChange, disabled }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-4 sm:px-6">
      <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {first}–{last} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1}>
          <ChevronLeft aria-hidden="true" data-icon="inline-start" />
          Previous
        </Button>
        <span className="px-1 text-sm font-medium tabular-nums">
          Page {Math.min(page, pages)} of {pages}
        </span>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= pages}>
          Next
          <ChevronRight aria-hidden="true" data-icon="inline-end" />
        </Button>
      </div>
    </nav>
  );
}
