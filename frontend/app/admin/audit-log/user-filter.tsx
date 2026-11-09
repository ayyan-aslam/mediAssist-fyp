"use client";

import { useId, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { MIN_SEARCH_LENGTH } from "@/hooks/use-search-param";
import { adminApi, adminUserQueryKey, adminUsersQueryKey } from "@/lib/api/admin";
import { ROLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEARCH_DELAY_MS = 300;
const RESULTS = 8;

// Picks one user for the audit log filter. The admin searches by name, email or phone (GET /admin/users).
export function UserFilter({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number | null;
  onChange: (userId: number | null) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const debounced = useDebouncedValue(input.trim(), SEARCH_DELAY_MS);
  const search = debounced.length >= MIN_SEARCH_LENGTH ? debounced : "";

  // The chosen user's name, also when the filter came from the URL (?userId=).
  const selected = useQuery({
    queryKey: adminUserQueryKey(value ?? 0),
    queryFn: () => adminApi.getUser(value!),
    enabled: value !== null,
  });

  const filters = { search: search || undefined, page: 1, pageSize: RESULTS };
  const results = useQuery({
    queryKey: adminUsersQueryKey(filters),
    queryFn: () => adminApi.listUsers(filters),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const matches = results.data?.items ?? [];

  const choose = (userId: number) => {
    onChange(userId);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches[activeIndex]) choose(matches[activeIndex].userId);
    }
  };

  const label =
    value === null ? "All users" : (selected.data?.fullName ?? (selected.isError ? `User ${value}` : "Loading…"));

  return (
    <div className="relative">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setInput("");
            setActiveIndex(0);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-background px-4 text-left text-base transition-[color,box-shadow,border-color] outline-none hover:border-foreground/25 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 md:text-sm dark:bg-input/30",
              value !== null && "pr-12",
            )}
          >
            <span className={cn("truncate", value === null && "text-muted-foreground")}>{label}</span>
            {value === null && <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 gap-1.5 p-1.5">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              role="combobox"
              aria-label="Search users by name, email or phone"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              placeholder="Name, email or phone"
              autoComplete="off"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              className="h-10 pr-9 pl-9"
            />
            {results.isFetching && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" label="Searching" />}
          </div>

          <ul id={listId} role="listbox" aria-label="Users" className="max-h-72 overflow-y-auto">
            {matches.map((user, index) => (
              <li
                key={user.userId}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={user.userId === value}
                data-active={index === activeIndex}
                // Keep the focus in the search box.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(user.userId)}
                className="flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{user.fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {ROLE_LABEL[user.role]} · {user.email}
                  </span>
                </span>
                {user.userId === value && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
              </li>
            ))}
          </ul>
          {results.isSuccess && matches.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No user found. Check the spelling.</p>
          )}
          {results.isError && (
            <p className="px-3 py-6 text-center text-sm text-destructive">The users could not be loaded. Please try again.</p>
          )}
        </PopoverContent>
      </Popover>

      {value !== null && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange(null)}
          aria-label="Show all users"
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
