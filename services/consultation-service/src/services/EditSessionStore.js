// The open SOAP note editing sessions, in memory (design doc Diagram 12): one per consultation, with
// who is editing, the IP address, the time of the last edit and whether anything changed.
// Every method is synchronous, so a session can only be ended once, by finish-editing or by the checker.
export class EditSessionStore {
  constructor() {
    this.sessions = new Map();
  }

  // Opening the note again (another tab, a reload) keeps the running session and its changes.
  startSession(consultationId, doctorId, ipAddress, now = new Date()) {
    if (!this.sessions.has(consultationId)) {
      this.sessions.set(consultationId, { consultationId, doctorId, ipAddress, lastActiveAt: now, changed: false });
    }
  }

  // After an auto-save. Starts the session when there is none (for example, after a restart).
  markChanged(consultationId, doctorId, ipAddress, now = new Date()) {
    this.startSession(consultationId, doctorId, ipAddress, now);
    const session = this.sessions.get(consultationId);
    Object.assign(session, { lastActiveAt: now, changed: true });
  }

  // Removes the session and returns it, or null when there is none.
  endSession(consultationId) {
    const session = this.sessions.get(consultationId) ?? null;
    this.sessions.delete(consultationId);
    return session;
  }

  // Puts back an ended session whose audit event could not be sent, so the checker sends it later.
  // If a new session started meanwhile, it now counts as changed.
  restore(session) {
    const current = this.sessions.get(session.consultationId);
    if (current) current.changed = true;
    else this.sessions.set(session.consultationId, session);
  }

  // Sessions with no activity for idleMs.
  findIdle(idleMs, now = new Date()) {
    return [...this.sessions.values()].filter((session) => now - session.lastActiveAt >= idleMs);
  }
}
