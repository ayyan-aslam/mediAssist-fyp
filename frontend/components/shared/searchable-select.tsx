"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: number;
  label: string;
}

interface SearchableSelectProps {
  id: string;
  options: SelectOption[];
  value: number | null;
  onChange: (value: number) => void;
  onBlur?: () => void;
  placeholder: string;
  searchLabel: string;
  emptyText: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

// A select with a search box, for long lists such as the specialities.
// Keyboard: type to filter, arrow keys to move, Enter to choose, Escape to close.
export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  onBlur,
  placeholder,
  searchLabel,
  emptyText,
  disabled,
  ...aria
}: SearchableSelectProps) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => option.value === value);
  const search = query.trim().toLowerCase();
  const matches = search ? options.filter((option) => option.label.toLowerCase().includes(search)) : options;

  // Keep the highlighted option visible while moving with the arrow keys.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    } else {
      onBlur?.();
    }
  }

  function choose(option: SelectOption) {
    onChange(option.value);
    changeOpen(false);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches[activeIndex]) choose(matches[activeIndex]);
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          {...aria}
          className="flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-background px-4 text-left text-base transition-[color,box-shadow,border-color] outline-none hover:border-foreground/25 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-60 gap-1.5 p-1.5">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            role="combobox"
            aria-label={searchLabel}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={matches[activeIndex] ? optionId(activeIndex) : undefined}
            placeholder={searchLabel}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onSearchKeyDown}
            className="h-10 pl-9"
          />
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label={searchLabel} className="max-h-64 overflow-y-auto">
          {matches.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              // Keep the focus in the search box.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.value === value && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
            </li>
          ))}
        </ul>
        {matches.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>}
      </PopoverContent>
    </Popover>
  );
}
