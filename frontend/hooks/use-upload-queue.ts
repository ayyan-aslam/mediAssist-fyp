"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioPart } from "@/hooks/use-chunked-recorder";
import { ApiError } from "@/lib/api/client";
import { consultationsApi } from "@/lib/api/consultations";

// Uploads the audio parts one by one, in order (POST /consultations/{id}/audio-parts).
// Every part stays in memory until the recording is stopped, so parts that did not arrive
// can be sent again (409 PARTS_MISSING). A failed upload is tried again with a growing wait,
// and the queue waits while the browser is offline.

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export interface UploadQueueState {
  // Parts not saved yet, including the one being uploaded.
  pending: number;
  online: boolean;
  // The last upload failed and will be tried again.
  retrying: boolean;
  // An error that trying again cannot fix (for example 409 NOT_RECORDING). Uploads stop.
  error: ApiError | null;
}

// Network errors, timeouts, rate limits and server errors may pass. Anything else will not.
function canRetry(err: unknown) {
  if (!(err instanceof ApiError)) return true;
  if (err.code === "SESSION_ENDED") return false;
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
}

function retryDelay(failures: number) {
  const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (failures - 1));
  return delay * (0.8 + Math.random() * 0.4);
}

export function useUploadQueue(consultationId: number) {
  const [state, setState] = useState<UploadQueueState>({ pending: 0, online: true, retrying: false, error: null });

  const parts = useRef(new Map<number, AudioPart>());
  const pending = useRef(new Set<number>());
  const running = useRef(false);
  const disposed = useRef(false);
  const fatal = useRef<ApiError | null>(null);
  // Ends the current wait early (the browser came back online).
  const wake = useRef<() => void>(() => {});
  // waitUntilEmpty() callers.
  const waiters = useRef<{ resolve: () => void; reject: (err: ApiError) => void }[]>([]);

  const update = useCallback((changes: Partial<UploadQueueState> = {}) => {
    setState((prev) => ({ ...prev, pending: pending.current.size, error: fatal.current, ...changes }));
  }, []);

  const settleWaiters = useCallback(() => {
    if (fatal.current) {
      const err = fatal.current;
      waiters.current.splice(0).forEach((w) => w.reject(err));
    } else if (pending.current.size === 0 && !running.current) {
      waiters.current.splice(0).forEach((w) => w.resolve());
    }
  }, []);

  // Waits for `ms` (forever when null), or until wake() is called.
  const sleep = (ms: number | null) =>
    new Promise<void>((resolve) => {
      const timer = ms === null ? undefined : setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wake.current = () => {};
        resolve();
      }
      wake.current = done;
    });

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let failures = 0;
    try {
      while (pending.current.size > 0 && !disposed.current && !fatal.current) {
        if (!navigator.onLine) {
          update({ online: false });
          await sleep(null);
          continue;
        }
        const partNo = Math.min(...pending.current);
        const part = parts.current.get(partNo)!;
        try {
          // 201 (saved now) and 200 (saved before) both mean the part is safe.
          await consultationsApi.uploadPart(consultationId, part);
          pending.current.delete(partNo);
          failures = 0;
          update({ retrying: false });
        } catch (err) {
          if (!canRetry(err)) {
            fatal.current = err as ApiError;
            update({ retrying: false });
            break;
          }
          failures += 1;
          update({ retrying: true });
          await sleep(retryDelay(failures));
        }
      }
    } finally {
      running.current = false;
      settleWaiters();
    }
  }, [consultationId, settleWaiters, update]);

  const add = useCallback(
    (part: AudioPart) => {
      parts.current.set(part.partNo, part);
      pending.current.add(part.partNo);
      update();
      void run();
    },
    [run, update],
  );

  // Sends these parts again. Returns the parts that are not in memory (lost in a page reload).
  const resend = useCallback(
    (partNos: number[]) => {
      const lost = partNos.filter((partNo) => !parts.current.has(partNo));
      partNos.filter((partNo) => parts.current.has(partNo)).forEach((partNo) => pending.current.add(partNo));
      update();
      void run();
      return lost;
    },
    [run, update],
  );

  // Resolves when every part is saved. Rejects when uploads stopped with an error.
  const waitUntilEmpty = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
        settleWaiters();
      }),
    [settleWaiters],
  );

  // Tries again after an error that stopped the uploads.
  const retry = useCallback(() => {
    fatal.current = null;
    update();
    void run();
  }, [run, update]);

  // The recording was discarded: drops every part and stops uploading for good.
  const cancel = useCallback(() => {
    disposed.current = true;
    fatal.current = null;
    pending.current.clear();
    parts.current.clear();
    wake.current();
    update({ retrying: false });
  }, [update]);

  useEffect(() => {
    disposed.current = false;
    const online = () => {
      update({ online: true });
      wake.current();
    };
    const offline = () => update({ online: false });
    update({ online: navigator.onLine });
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      disposed.current = true;
      wake.current();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [update]);

  return { state, add, resend, retry, waitUntilEmpty, cancel };
}
