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
