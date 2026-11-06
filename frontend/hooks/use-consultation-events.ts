"use client";

import { use, useEffect, useEffectEvent } from "react";
import { ConsultationEventsContext, type ConsultationEventsListener } from "@/context/consultation-events-context";

// Listens to the doctor's shared live update stream (see ConsultationEventsProvider).
// onConnect runs every time the stream opens or opens again; onEvent for soap_ready and consultation_failed.
export function useConsultationEvents(handlers: Partial<ConsultationEventsListener>) {
  const context = use(ConsultationEventsContext);
  if (!context) throw new Error("useConsultationEvents must be used inside ConsultationEventsProvider.");

  const onConnect = useEffectEvent(() => handlers.onConnect?.());
  const onEvent = useEffectEvent((event: Parameters<ConsultationEventsListener["onEvent"]>[0]) =>
    handlers.onEvent?.(event),
  );

  const { subscribe } = context;
  useEffect(
    () => subscribe({ onConnect: () => onConnect(), onEvent: (event) => onEvent(event) }),
    [subscribe],
  );

  return { status: context.status };
}
