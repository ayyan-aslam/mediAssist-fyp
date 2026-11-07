import { consultationNotFoundError, soapNotReadyError } from '../errors.js';
import { toAiInsights } from './aiInsights.js';

// audit.event soap_note_change (design doc 6.4.12) for one editing session, at the time of its last edit.
export function soapNoteChangeEvent(session) {
  return {
    userId: session.doctorId,
    action: 'soap_note_change',
    details: `SOAP note of consultation ${session.consultationId} edited`,
    ipAddress: session.ipAddress,
    occurredAt: session.lastActiveAt.toISOString(),
  };
}

const toSoapNote = (note) => ({
  soapNoteId: note.soapNoteId,
  consultationId: note.consultationId,
  subjective: note.subjective,
  objective: note.objective,
  assessment: note.assessment,
  plan: note.plan,
  updatedAt: note.updatedAt.toISOString(),
  aiInsights: toAiInsights(note.aiResult, { prescription: note.prescription, symptoms: note.symptoms }),
});

// Opens the SOAP note, saves the auto-save changes and ends the editing session (design doc Diagram 12).
// One audit event per editing session, and only if the note was changed; none for an auto-save.
export class SoapNoteEditService {
  constructor({ soapNoteRepository, editSessionStore, eventPublisher, logger }) {
    this.soapNoteRepository = soapNoteRepository;
    this.editSessionStore = editSessionStore;
    this.eventPublisher = eventPublisher;
    this.logger = logger;
  }

  async open(consultationId, doctorId, ipAddress) {
    const note = await this.#findSoapNote(consultationId, doctorId, { withAiResult: true });
    this.editSessionStore.startSession(consultationId, doctorId, ipAddress);
    return toSoapNote(note);
  }

  async autoSave(consultationId, doctorId, ipAddress, changes) {
    const updatedAt = await this.soapNoteRepository.update(consultationId, doctorId, changes);
    // No row changed: find out whether the consultation is missing (404) or has no note yet (409).
    if (!updatedAt) {
      await this.#findSoapNote(consultationId, doctorId);
      throw soapNotReadyError();
    }
    this.editSessionStore.markChanged(consultationId, doctorId, ipAddress, updatedAt);
    return { updatedAt: updatedAt.toISOString() };
  }

  async finishEditing(consultationId, doctorId) {
    if (!(await this.soapNoteRepository.findSoapNote(consultationId, doctorId))) throw consultationNotFoundError();
    const session = this.editSessionStore.endSession(consultationId);
    if (!session?.changed) return { changed: false };

    try {
      await this.eventPublisher.publish('audit.event', soapNoteChangeEvent(session));
    } catch (err) {
      // The note is saved. Keep the session, so the EditSessionChecker sends the event later.
      this.logger.error({ err, consultationId }, 'Could not send the SOAP note change audit event');
      this.editSessionStore.restore(session);
    }
    return { changed: true };
  }

  async #findSoapNote(consultationId, doctorId, options) {
    const row = await this.soapNoteRepository.findSoapNote(consultationId, doctorId, options);
    if (!row) throw consultationNotFoundError();
    if (!row.soapNote) throw soapNotReadyError();
    return row.soapNote;
  }
}
