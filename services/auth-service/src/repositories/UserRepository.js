// The profile table that belongs to each role.
const PROFILE_RELATION = {
  doctor: 'doctorProfile',
};

export class UserRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // Returns the fields that are already used, in this order: email, phone, cnic, registrationNo.
  async findDuplicates({ email, phone, cnicHash, registrationNo }) {
    const userConditions = [{ email }];
    if (phone) userConditions.push({ phone });
    const users = await this.prisma.user.findMany({
      where: { OR: userConditions },
      select: { email: true, phone: true },
    });

    const doctorConditions = [];
    if (cnicHash) doctorConditions.push({ cnicHash });
    if (registrationNo) doctorConditions.push({ registrationNo });
    const doctors = doctorConditions.length
      ? await this.prisma.doctorProfile.findMany({
          where: { OR: doctorConditions },
          select: { cnicHash: true, registrationNo: true },
        })
      : [];

    const taken = [];
    if (users.some((user) => user.email === email)) taken.push('email');
    if (phone && users.some((user) => user.phone === phone)) taken.push('phone');
    if (cnicHash && doctors.some((doctor) => doctor.cnicHash === cnicHash)) taken.push('cnic');
    if (registrationNo && doctors.some((doctor) => doctor.registrationNo === registrationNo)) {
      taken.push('registrationNo');
    }
    return taken;
  }

  // Prisma runs a nested create in one transaction, so USERS and the profile are saved together or not at all.
  async createUserWithProfile({ firebaseUid, fullName, email, phone, role, profile }) {
    const user = await this.prisma.user.create({
      data: {
        firebaseUid,
        fullName,
        email,
        phone,
        role,
        [PROFILE_RELATION[role]]: { create: profile },
      },
      select: { userId: true },
    });
    return user.userId;
  }

  findByFirebaseUid(firebaseUid) {
    return this.prisma.user.findUnique({ where: { firebaseUid } });
  }

  findById(userId) {
    return this.prisma.user.findUnique({ where: { userId } });
  }
}
