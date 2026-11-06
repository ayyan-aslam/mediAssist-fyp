import { Skeleton } from "@/components/ui/skeleton";

// Rows of a list card while it loads: avatar, two lines and a column.
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-6 py-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3.5 w-28" />
          </div>
          <Skeleton className="hidden h-4 w-28 sm:block" />
        </li>
      ))}
    </ul>
  );
}
