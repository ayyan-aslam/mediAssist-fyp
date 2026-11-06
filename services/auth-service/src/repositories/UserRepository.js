// The profile table that belongs to each role.
const PROFILE_RELATION = {
  patient: 'patientProfile',
  doctor: 'doctorProfile',
};

// The unique indexes of UserDB and the request field each one protects.
const UNIQUE_FIELDS = {
  users_email_key: 'email',
  users_phone_key: 'phone',
  doctor_profile_cnic_hash_key: 'cnic',
  doctor_profile_registration_no_key: 'registrationNo',
};

// The field that a unique index refused (Prisma error P2002), or null for any other error.
// findDuplicates() checks first, but two requests at the same moment can both pass that check.
export function takenField(err) {
  if (err?.code !== 'P2002') return null;
  return UNIQUE_FIELDS[err.meta?.driverAdapterError?.cause?.constraint?.index] ?? null;
}

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

  findByPhone(phone) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  // The user with the profile of their role. The CNIC columns are never selected.
  findProfileById(userId) {
    return this.prisma.user.findUnique({
      where: { userId },
      select: {
        userId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        patientProfile: { select: { dateOfBirth: true, gender: true } },
        doctorProfile: {
          select: { registrationNo: true, specialty: { select: { specialtyId: true, name: true } } },
        },
      },
    });
  }

  // Updates USERS and the role's profile in one query. Prisma skips fields that are undefined.
  async updateProfile(userId, role, { fullName, phone, profile }) {
    const data = { fullName, phone };
    if (Object.keys(profile).length > 0) {
      // A doctor always has a profile row. A patient who signed up with Google may not have one yet.
      data[PROFILE_RELATION[role]] =
        role === 'patient' ? { upsert: { create: profile, update: profile } } : { update: profile };
    }
    await this.prisma.user.update({ where: { userId }, data });
  }
}
