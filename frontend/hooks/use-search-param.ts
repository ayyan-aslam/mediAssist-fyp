import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export const MIN_SEARCH_LENGTH = 2;

// A search box kept in the URL (?q=), so the results are still there after going back.
// query is the debounced text to search for, or "" while it is shorter than MIN_SEARCH_LENGTH.
export function useSearchParam(delayMs: number) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [input, setInput] = useState(() => searchParams.get("q") ?? "");

  const debounced = useDebouncedValue(input.trim(), delayMs);
  const query = debounced.length >= MIN_SEARCH_LENGTH ? debounced : "";

  useEffect(() => {
    if ((searchParams.get("q") ?? "") === query) return;
    router.replace(query ? `${pathname}?q=${encodeURIComponent(query)}` : pathname, { scroll: false });
  }, [query, pathname, router, searchParams]);

  // True while the text is being typed (not searched yet), or too short.
  const tooShort = input.trim().length > 0 && input.trim().length < MIN_SEARCH_LENGTH;
  const typing = input.trim() !== debounced;

  return { input, setInput, query, tooShort, typing };
}
