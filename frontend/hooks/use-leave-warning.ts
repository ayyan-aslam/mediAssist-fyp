"use client";

import { useEffect } from "react";

// Warns before the page is left while `active`: on reload or closing the tab (beforeunload),
// and on links inside the app, which change the page without unloading it.
export function useLeaveWarning(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue set. The browser shows its own text.
      event.returnValue = "";
    };

    // Capture phase on the document runs before the Next.js Link handler.
    const linkClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank" || event.defaultPrevented) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", linkClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", linkClick, true);
    };
  }, [active, message]);
}
