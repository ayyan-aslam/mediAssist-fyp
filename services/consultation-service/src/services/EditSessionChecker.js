import { soapNoteChangeEvent } from './SoapNoteEditService.js';

// After 5 minutes with no edit, a session counts as ended (design doc 3.8 and Diagram 12).
export const EDIT_SESSION_IDLE_MS = 5 * 60_000;

// The edit session check (design doc 3.8): finds editing sessions with no edit for 5 minutes, for example
// when the app was closed without finish-editing, and sends their audit event if the note was changed.
export class EditSessionChecker {
  constructor({ editSessionStore, eventPublisher, logger, idleMs = EDIT_SESSION_IDLE_MS }) {
    this.editSessionStore = editSessionStore;
    this.eventPublisher = eventPublisher;
    this.logger = logger;
    this.idleMs = idleMs;
  }

  // idleMs 0 ends every session (on shutdown).
  async check(idleMs = this.idleMs) {
    for (const { consultationId } of this.editSessionStore.findIdle(idleMs)) {
      // endSession returns null when finish-editing ended it in the meantime.
      const session = this.editSessionStore.endSession(consultationId);
      if (!session?.changed) continue;
      try {
        await this.eventPublisher.publish('audit.event', soapNoteChangeEvent(session));
        this.logger.info({ consultationId }, 'Sent the audit event of an idle SOAP note editing session');
      } catch (err) {
        this.logger.error({ err, consultationId }, 'Could not send the SOAP note change audit event');
        this.editSessionStore.restore(session);
      }
    }
  }
}
