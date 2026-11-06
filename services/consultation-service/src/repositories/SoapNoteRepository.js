// Thrown inside the transaction to roll it back when the consultation moved on (another attempt, or done).
class StaleAnswer extends Error {}

const isUniqueViolation = (err) => err?.code === 'P2002';
const DOCTOR_ID = { consultationId: true, clinicalPatient: { select: { doctorId: true } } };
const toDoctor = (row) => ({ consultationId: row.consultationId, doctorId: row.clinicalPatient.doctorId });

// Saves the SOAP_NOTE row and the CONSULTATION status, attempt and failure reason (design doc Diagram 6).
// Every update checks the status (and the attempt), so a message handled twice changes nothing.
export class SoapNoteRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // Status, attempt, whether a note exists, and the doctor and patient, or null.
  async findConsultation(consultationId) {
    const row = await this.prisma.consultation.findUnique({
      where: { consultationId },
      select: {
        consultationId: true,
        status: true,
        soapAttempt: true,
        clinicalPatient: { select: { clinicalPatientId: true, doctorId: true, age: true, gender: true } },
        soapNote: { select: { soapNoteId: true } },
      },
    });
    if (!row) return null;
    const { clinicalPatient, soapNote, ...consultation } = row;
    return {
      ...consultation,
      hasNote: soapNote !== null,
      doctorId: clinicalPatient.doctorId,
      clinicalPatientId: clinicalPatient.clinicalPatientId,
      patientAge: clinicalPatient.age,
      patientGender: clinicalPatient.gender,
    };
  }

  // Length of the recording: the parts 1 to totalParts.
  async getDurationSec(consultationId, totalParts) {
    const { _sum } = await this.prisma.audioPart.aggregate({
      where: { consultationId, partNo: { lte: totalParts } },
      _sum: { durationSec: true },
    });
    return _sum.durationSec ?? 0;
  }

  // Returns false when the consultation is no longer processing this attempt.
  async setAiRequestedAt(consultationId, attempt, aiRequestedAt) {
    const { count } = await this.prisma.consultation.updateMany({
      where: { consultationId, status: 'processing', soapAttempt: attempt },
      data: { aiRequestedAt },
    });
    return count === 1;
  }

  // processing -> failed. With an attempt, only for that attempt. Returns { consultationId, doctorId } or
  // null when nothing changed (already completed or failed, or an old attempt).
  async markFailed(consultationId, failureReason, attempt) {
    const rows = await this.prisma.consultation.updateManyAndReturn({
      where: { consultationId, status: 'processing', ...(attempt !== undefined && { soapAttempt: attempt }) },
      data: { status: 'failed', failureReason },
      select: DOCTOR_ID,
    });
    return rows[0] ? toDoctor(rows[0]) : null;
  }

  // In one transaction: CONSULTATION processing -> completed for this attempt, and the SOAP_NOTE insert.
  // The update runs first and locks the row, so two copies of the same answer cannot both save a note.
  // Returns the note, or null when the answer is old or a note already exists.
  async saveSoapNote(consultationId, attempt, { subjective, objective, assessment, plan, aiResult }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.consultation.updateMany({
          where: { consultationId, status: 'processing', soapAttempt: attempt },
          data: { status: 'completed' },
        });
        if (count === 0) throw new StaleAnswer();
        return tx.soapNote.create({
          data: { consultationId, subjective, objective, assessment, plan, aiResult: aiResult ?? undefined },
        });
      });
    } catch (err) {
      if (err instanceof StaleAnswer || isUniqueViolation(err)) return null;
      throw err;
    }
  }

  // AI answer check: one UPDATE ... RETURNING for every consultation that waited too long.
  async markTimedOut(requestedBefore) {
    const rows = await this.prisma.consultation.updateManyAndReturn({
      where: { status: 'processing', aiRequestedAt: { lt: requestedBefore } },
      data: { status: 'failed', failureReason: 'AI_TIMEOUT' },
      select: DOCTOR_ID,
    });
    return rows.map(toDoctor);
  }
}
