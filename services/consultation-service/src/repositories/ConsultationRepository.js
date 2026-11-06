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
