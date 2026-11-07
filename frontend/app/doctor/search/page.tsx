import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchScreen } from "./search-screen";

export const metadata: Metadata = { title: "Search SOAP notes" };

// Suspense: the search box reads ?q= from the URL.
export default function SearchPage() {
  return (
    <Suspense>
      <SearchScreen />
    </Suspense>
  );
}
