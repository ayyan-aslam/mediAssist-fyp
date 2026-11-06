"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { consultationsApi } from "@/lib/api/consultations";
import type { SoapNote, SoapNoteChanges, SoapPart } from "@/lib/api/types";

export const SOAP_PARTS: SoapPart[] = ["subjective", "objective", "assessment", "plan"];

// The app saves every 30 seconds while the doctor edits (design doc 5.5, PATCH soap-note).
const AUTO_SAVE_MS = 30_000;
// After a failed save, the next try comes sooner.
const RETRY_MS = 10_000;

export type SoapValues = Record<SoapPart, string>;

export type SaveState =
  | { kind: "saved"; at: string }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "error" };

const pick = (note: SoapNote): SoapValues => ({
  subjective: note.subjective,
  objective: note.objective,
  assessment: note.assessment,
  plan: note.plan,
});

// The parts that differ from the last saved values.
function changesSince(saved: SoapValues, current: SoapValues): SoapNoteChanges {
  return Object.fromEntries(SOAP_PARTS.filter((part) => current[part] !== saved[part]).map((part) => [part, current[part]]));
}

const isEmpty = (changes: SoapNoteChanges) => Object.keys(changes).length === 0;

// Browsers refuse keepalive requests with a body over 64 KB, so a very long change is sent without it.
const KEEPALIVE_MAX_BYTES = 60_000;
const fitsKeepalive = (changes: SoapNoteChanges) =>
  new TextEncoder().encode(JSON.stringify(changes)).length <= KEEPALIVE_MAX_BYTES;

// Editing one SOAP note (design doc Diagram 12): auto-save of the changed parts every 30 seconds,
// save now, and finish-editing when the doctor presses Save or leaves the page.
export function useSoapNoteEditor(note: SoapNote) {
  const consultationId = note.consultationId;
  const [values, setValues] = useState<SoapValues>(() => pick(note));
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved", at: note.updatedAt });

  const valuesRef = useRef(values);
  const savedRef = useRef(values);
  // Saves run one after another, so two never send the same change.
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  // When the last save was tried, and whether it failed: the timer below uses both.
  const lastTryRef = useRef(0);
  const failedRef = useRef(false);

  const setPart = useCallback((part: SoapPart, value: string) => {
    valuesRef.current = { ...valuesRef.current, [part]: value };
    setValues(valuesRef.current);
    setSaveState((state) => (state.kind === "saving" || state.kind === "error" ? state : { kind: "unsaved" }));
  }, []);

  const saveOnce = useCallback(async (keepalive: boolean) => {
    lastTryRef.current = Date.now();
    const changes = changesSince(savedRef.current, valuesRef.current);
    if (isEmpty(changes)) return true;

    setSaveState({ kind: "saving" });
    try {
      const { updatedAt } = await consultationsApi.updateSoapNote(consultationId, changes, {
        keepalive: keepalive && fitsKeepalive(changes),
      });
      savedRef.current = { ...savedRef.current, ...changes };
      // The doctor may have typed while the request was running.
      const pending = !isEmpty(changesSince(savedRef.current, valuesRef.current));
      setSaveState(pending ? { kind: "unsaved" } : { kind: "saved", at: updatedAt });
      failedRef.current = false;
      return true;
    } catch {
      setSaveState({ kind: "error" });
      failedRef.current = true;
      return false;
    }
  }, [consultationId]);

  // Saves the parts that changed since the last save. Resolves false when the save failed.
  // keepalive when the page may be closed before the answer comes.
  const saveNow = useCallback(
    (keepalive = false) => {
      chainRef.current = chainRef.current.then(() => saveOnce(keepalive));
      return chainRef.current;
    },
    [saveOnce],
  );

  // Save button: save now, then end the editing session (one audit event if the note changed).
  const finishEditing = useCallback(async () => {
    if (!(await saveNow())) return false;
    await consultationsApi.finishEditing(consultationId);
    return true;
  }, [consultationId, saveNow]);

  useEffect(() => {
    // Saves 30 seconds after the last try (or after the page opened), or 10 seconds after a failed one.
    lastTryRef.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - lastTryRef.current >= (failedRef.current ? RETRY_MS : AUTO_SAVE_MS)) void saveNow();
    }, 1000);
    // A phone may close a hidden tab without any other event, so save when the page is hidden.
    const onHidden = () => {
      if (document.visibilityState === "hidden") void saveNow(true);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [saveNow]);

  // Leaving the page (a link in the app, reload or closing the tab): send the last changes and
  // finish-editing with fetch keepalive, so they still arrive after the page is gone. Not sendBeacon,
  // because it cannot send the Authorization header. Finish waits for the save, so the session is
  // ended with the change in it (sent together, finish could arrive first and the change would start
  // a second session). If the page is gone before the save answers, the EditSessionChecker on the
  // server ends the session after 5 minutes, so there is still exactly one audit event.
  useEffect(() => {
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      const changes = changesSince(savedRef.current, valuesRef.current);
      const save = isEmpty(changes)
        ? Promise.resolve()
        : consultationsApi.updateSoapNote(consultationId, changes, { keepalive: fitsKeepalive(changes) }).then(() => {
            savedRef.current = { ...savedRef.current, ...changes };
          });
      void save
        .then(() => consultationsApi.finishEditing(consultationId, { keepalive: true }))
        .catch(() => {});
    };
    // Back from the browser's page cache: the doctor is editing again.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) left = false;
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", onPageShow);
      leave();
    };
  }, [consultationId]);

  return { values, setPart, saveState, saveNow, finishEditing };
}
