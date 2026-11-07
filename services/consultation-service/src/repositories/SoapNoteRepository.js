import { Prisma } from '../../generated/prisma/client.ts';
import { likePattern } from './likePattern.js';

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

  // SOAP note editing (design doc Diagram 12). Every query below includes doctorId, so a doctor never
  // reads or changes the notes of another doctor's patients.

  // null when the consultation does not exist or belongs to another doctor; otherwise { soapNote } with
  // soapNote null until the note is ready. ai_result is large, so it is read only when asked for.
  findSoapNote(consultationId, doctorId, { withAiResult = false } = {}) {
    return this.prisma.consultation.findFirst({
      where: { consultationId, clinicalPatient: { doctorId } },
      select: { soapNote: withAiResult ? true : { omit: { aiResult: true } } },
    });
  }

  // For the PDF: the consultation date, the patient and the note. Same null / { soapNote: null } rule as above.
  findForPdf(consultationId, doctorId) {
    return this.prisma.consultation.findFirst({
      where: { consultationId, clinicalPatient: { doctorId } },
      select: {
        startedAt: true,
        clinicalPatient: { select: { fullName: true, age: true, gender: true, phone: true } },
        soapNote: {
          select: {
            subjective: true,
            objective: true,
            assessment: true,
            plan: true,
            aiResult: true,
            prescription: true,
            symptoms: true,
          },
        },
      },
    });
  }

  // Saves only the sent parts. Returns the new updated_at, or null when there is no note of this doctor.
  // A null prescription or symptoms list is saved as SQL NULL (back to the AI version).
  async update(consultationId, doctorId, changes) {
    const data = { ...changes, updatedAt: new Date() };
    for (const key of ['prescription', 'symptoms']) {
      if (data[key] === null) data[key] = Prisma.DbNull;
    }
    const rows = await this.prisma.soapNote.updateManyAndReturn({
      where: { consultationId, consultation: { clinicalPatient: { doctorId } } },
      data,
      select: { updatedAt: true },
    });
    return rows[0]?.updatedAt ?? null;
  }

  // A patient's consultations with the assessment of their note, newest first (index on
  // clinical_patient_id, started_at). The note is null when the consultation has none yet.
  async findByPatient(doctorId, clinicalPatientId, { page, pageSize }) {
    const where = { clinicalPatientId, clinicalPatient: { doctorId } };
    const [rows, total] = await Promise.all([
      this.prisma.consultation.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { consultationId: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { consultationId: true, startedAt: true, status: true, soapNote: { select: { assessment: true } } },
      }),
      this.prisma.consultation.count({ where }),
    ]);
    return { rows, total };
  }

  // The doctor's SOAP notes, newest first. With q, only notes whose patient name or phone contains q
  // (ILIKE '%q%', served by the trigram indexes). Without q, all of them (GET /soap-notes).
  async search(doctorId, q, { page, pageSize }) {
    const nameOrPhone = q
      ? Prisma.sql`AND (p.full_name ILIKE ${likePattern(q)} OR p.phone ILIKE ${likePattern(q)})`
      : Prisma.empty;
    const match = Prisma.sql`
      FROM soap_note s
      JOIN consultation c ON c.consultation_id = s.consultation_id
      JOIN clinical_patient p ON p.clinical_patient_id = c.clinical_patient_id
      WHERE p.doctor_id = ${doctorId} ${nameOrPhone}`;
    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT c.consultation_id AS "consultationId", c.started_at AS "startedAt",
               p.clinical_patient_id AS "clinicalPatientId", p.full_name AS "fullName", p.phone
        ${match}
        ORDER BY c.started_at DESC, c.consultation_id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw`SELECT COUNT(*)::int AS total ${match}`,
    ]);
    return { rows, total };
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
