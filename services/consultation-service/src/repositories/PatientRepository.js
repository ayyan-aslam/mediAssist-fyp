import { Prisma } from '../../generated/prisma/client.ts';
import { likePattern } from './likePattern.js';

// Reads and saves CLINICAL_PATIENT rows. Every query that a doctor triggers includes doctorId,
// so a doctor can never read or change another doctor's patients.
export class PatientRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // Throws Prisma error P2002 when the doctor already saved this phone.
  insert(doctorId, data) {
    return this.prisma.clinicalPatient.create({ data: { doctorId, ...data } });
  }

  findByDoctorAndPhone(doctorId, phone) {
    return this.prisma.clinicalPatient.findUnique({ where: { doctorId_phone: { doctorId, phone } } });
  }

  findByDoctorAndId(doctorId, clinicalPatientId) {
    return this.prisma.clinicalPatient.findFirst({ where: { clinicalPatientId, doctorId } });
  }

  // The doctor's patients, newest first. With q, only patients whose name or phone contains q
  // (ILIKE '%q%', served by the trigram indexes).
  async list(doctorId, q, { page, pageSize }) {
    const nameOrPhone = q
      ? Prisma.sql`AND (full_name ILIKE ${likePattern(q)} OR phone ILIKE ${likePattern(q)})`
      : Prisma.empty;
    const match = Prisma.sql`FROM clinical_patient WHERE doctor_id = ${doctorId} ${nameOrPhone}`;
    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT clinical_patient_id AS "clinicalPatientId", full_name AS "fullName", phone, email, age, gender,
               created_at AS "createdAt"
        ${match}
        ORDER BY created_at DESC, clinical_patient_id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw`SELECT COUNT(*)::int AS total ${match}`,
    ]);
    return { rows, total };
  }

  // Returns false when the patient does not exist or belongs to another doctor.
  // Throws Prisma error P2002 when the new phone is already saved by this doctor.
  async update(doctorId, clinicalPatientId, changes) {
    const { count } = await this.prisma.clinicalPatient.updateMany({
      where: { clinicalPatientId, doctorId },
      data: changes,
    });
    return count === 1;
  }
}
