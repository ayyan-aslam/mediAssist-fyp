const PATIENT_SUMMARY = { select: { clinicalPatientId: true, fullName: true, phone: true } };

// Reads and saves CONSULTATION and AUDIO_PART rows.
// A consultation belongs to the doctor who owns its clinic patient.
export class ConsultationRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  create({ clinicalPatientId, status, startedAt }) {
    return this.prisma.consultation.create({ data: { clinicalPatientId, status, startedAt } });
  }

  // The consultation with a short patient summary, or null when it belongs to another doctor.
  findByDoctorAndId(doctorId, consultationId) {
    return this.prisma.consultation.findFirst({
      where: { consultationId, clinicalPatient: { doctorId } },
      include: { clinicalPatient: PATIENT_SUMMARY },
    });
  }

  findPart(consultationId, partNo) {
    return this.prisma.audioPart.findUnique({
      where: { consultationId_partNo: { consultationId, partNo } },
    });
  }

  // Throws Prisma error P2002 when the part is already saved (the same part sent twice at once).
  savePart({ consultationId, partNo, fileKey, durationSec }) {
    return this.prisma.audioPart.create({
      data: { consultationId, partNo, fileKey, durationSec, recordedAt: new Date() },
    });
  }

  // Number of saved parts from firstPartNo to lastPartNo.
  countPartsInRange(consultationId, firstPartNo, lastPartNo) {
    return this.prisma.audioPart.count({
      where: { consultationId, partNo: { gte: firstPartNo, lte: lastPartNo } },
    });
  }

  // The parts from firstPartNo to lastPartNo, in play order.
  findPartsInRange(consultationId, firstPartNo, lastPartNo) {
    return this.prisma.audioPart.findMany({
      where: { consultationId, partNo: { gte: firstPartNo, lte: lastPartNo } },
      orderBy: { partNo: 'asc' },
    });
  }

  // The numbers of all saved parts, in order.
  async findSavedPartNos(consultationId) {
    const parts = await this.prisma.audioPart.findMany({
      where: { consultationId },
      select: { partNo: true },
      orderBy: { partNo: 'asc' },
    });
    return parts.map((part) => part.partNo);
  }

  countParts(consultationId) {
    return this.prisma.audioPart.count({ where: { consultationId } });
  }

  // Stop: recording -> processing. Returns false when it was not recording any more (stopped twice at once).
  async markProcessing(consultationId, endedAt) {
    const { count } = await this.prisma.consultation.updateMany({
      where: { consultationId, status: 'recording' },
      data: { status: 'processing', endedAt },
    });
    return count === 1;
  }

  // Undoes markProcessing when consultation.recorded could not be sent, so the app can call stop again.
  backToRecording(consultationId) {
    return this.prisma.consultation.updateMany({
      where: { consultationId, status: 'processing' },
      data: { status: 'recording', endedAt: null },
    });
  }

  // Try again: one update from failed to processing with the next attempt.
  // Returns false when the consultation is not failed.
  async startRetry(consultationId) {
    const { count } = await this.prisma.consultation.updateMany({
      where: { consultationId, status: 'failed' },
      data: { soapAttempt: { increment: 1 }, status: 'processing', failureReason: null, aiRequestedAt: null },
    });
    return count === 1;
  }

  // Undoes startRetry when consultation.recorded could not be sent. The attempt stays higher, which is safe.
  backToFailed(consultationId, failureReason) {
    return this.prisma.consultation.updateMany({
      where: { consultationId, status: 'processing' },
      data: { status: 'failed', failureReason },
    });
  }

  // Discard: deletes the consultation when its status is one of `statuses`, with its parts and transcript
  // minutes (ON DELETE CASCADE). Returns the S3 keys of its parts, or null when the status changed meanwhile.
  async deleteDiscardable(consultationId, statuses) {
    return this.prisma.$transaction(async (tx) => {
      const parts = await tx.audioPart.findMany({ where: { consultationId }, select: { fileKey: true } });
      const { count } = await tx.consultation.deleteMany({ where: { consultationId, status: { in: statuses } } });
      return count === 1 ? parts.map((part) => part.fileKey) : null;
    });
  }

  // Saves the follow-up date (null removes it). Returns the patient's name and email for followup.changed,
  // or null when the consultation does not exist or belongs to another doctor.
  async updateFollowUp(consultationId, doctorId, followUpDate) {
    const rows = await this.prisma.consultation.updateManyAndReturn({
      where: { consultationId, clinicalPatient: { doctorId } },
      data: { followUpDate },
      select: { clinicalPatient: { select: { fullName: true, email: true } } },
    });
    return rows[0]?.clinicalPatient ?? null;
  }

  // Internal use only (Prescription Service): no doctor check.
  findPatientContact(consultationId) {
    return this.prisma.consultation.findUnique({
      where: { consultationId },
      select: {
        clinicalPatient: { select: { fullName: true, age: true, gender: true, phone: true, email: true } },
      },
    });
  }
}
