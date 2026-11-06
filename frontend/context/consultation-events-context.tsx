"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { freshAccessToken } from "@/lib/api/client";
import { getAccessTokenExpiry } from "@/lib/api/tokens";
import type { ConsultationEvent } from "@/lib/api/types";
import { env } from "@/lib/env";

// connecting: the first connection is being opened. reconnecting: it dropped and is opened again.
export type ConsultationEventsStatus = "connecting" | "open" | "reconnecting";

export interface ConsultationEventsListener {
  // Every time the stream opens or opens again, so a screen can read what it missed meanwhile.
  onConnect: () => void;
  onEvent: (event: ConsultationEvent) => void;
}

export interface ConsultationEventsContextValue {
  status: ConsultationEventsStatus;
  subscribe: (listener: ConsultationEventsListener) => () => void;
}

export const ConsultationEventsContext = createContext<ConsultationEventsContextValue | null>(null);

const EVENT_NAMES = ["soap_ready", "consultation_failed"] as const;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// The stream is opened again with a new token this long before the old one expires.
const RENEW_BEFORE_EXPIRY_MS = 60_000;

// One live update stream (GET /consultations/events, design doc 3.7 and 5.5) for the logged-in doctor,
// shared by every screen. A browser EventSource cannot send headers, so the access token goes in ?token=.
export function ConsultationEventsProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef(new Set<ConsultationEventsListener>());
  const [status, setStatus] = useState<ConsultationEventsStatus>(env.useMocks ? "open" : "connecting");

  useEffect(() => {
    // Mock mode has no backend stream. Screens still read the consultation once when they open.
    if (env.useMocks) return;

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let delay = RECONNECT_MIN_MS;

    const notify = (call: (listener: ConsultationEventsListener) => void) => {
      for (const listener of [...listeners.current]) call(listener);
    };

    const close = () => {
      clearTimeout(timer);
      source?.close();
      source = null;
    };

    const reconnectLater = (forceRefresh: boolean) => {
      close();
      setStatus("reconnecting");
      timer = setTimeout(() => void connect(forceRefresh), delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    };

    // Opens the stream again with a new token shortly before the current one expires.
    const renewBeforeExpiry = () => {
      const expiresAt = getAccessTokenExpiry();
      if (expiresAt === null) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          close();
          void connect(false);
        },
        Math.max(expiresAt - Date.now() - RENEW_BEFORE_EXPIRY_MS, 0),
      );
    };

    async function connect(forceRefresh: boolean) {
      // A refresh that fails is tried again later; a real logout comes from the next API call.
      const token = await freshAccessToken({ force: forceRefresh, marginMs: RENEW_BEFORE_EXPIRY_MS });
      if (stopped) return;
      if (!token) {
        reconnectLater(true);
        return;
      }

      const es = new EventSource(`${env.apiUrl}/consultations/events?token=${encodeURIComponent(token)}`);
      source = es;
      let opened = false;

      es.onopen = () => {
        opened = true;
        delay = RECONNECT_MIN_MS;
        setStatus("open");
        renewBeforeExpiry();
        notify((listener) => listener.onConnect());
      };
      // The browser would reconnect by itself, but with the same (maybe expired) token.
      // A stream that never opened was most likely refused (401), so the token is refreshed first.
      es.onerror = () => {
        if (source === es) reconnectLater(!opened);
      };
      for (const name of EVENT_NAMES) {
        es.addEventListener(name, (message) => {
          let data;
          try {
            data = JSON.parse((message as MessageEvent<string>).data);
          } catch {
            return;
          }
          notify((listener) => listener.onEvent({ event: name, data } as ConsultationEvent));
        });
      }
    }

    // Back online: connect now instead of waiting for the backoff.
    const onOnline = () => {
      if (source?.readyState === EventSource.OPEN) return;
      close();
      void connect(false);
    };

    void connect(false);
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      close();
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const subscribe = useCallback((listener: ConsultationEventsListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);

  return <ConsultationEventsContext value={value}>{children}</ConsultationEventsContext>;
}
