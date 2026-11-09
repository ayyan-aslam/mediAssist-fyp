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

// The fields of an admin user list item (design doc 5.2). The CNIC columns are never selected.
const ADMIN_USER_SELECT = {
  userId: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  accountStatus: true,
  createdAt: true,
  doctorProfile: { select: { specialty: { select: { specialtyId: true, name: true } } } },
};

// WHERE for GET /admin/users. The search is a partial match (ILIKE '%text%'), served by the trigram indexes.
function adminUserWhere({ search, role, status, specialtyId }) {
  const where = { role, accountStatus: status };
  if (specialtyId) where.doctorProfile = { specialtyId };
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }
  return where;
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

  // One page of users, newest first. filters: { search, role, status, specialtyId }, each optional.
  async findAdminPage(filters, { page, pageSize }) {
    const where = adminUserWhere(filters);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: ADMIN_USER_SELECT,
        orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  findAdminUserById(userId) {
    return this.prisma.user.findUnique({ where: { userId }, select: ADMIN_USER_SELECT });
  }

  // Names and roles for the audit log (GET /internal/users).
  findNamesByIds(userIds) {
    return this.prisma.user.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, fullName: true, role: true },
      orderBy: { userId: 'asc' },
    });
  }

  // Sets the account status. On suspension it also deletes all the user's refresh tokens (every device).
  // Both run in one transaction (design doc Diagram 11). beforeCommit runs last inside it (it sends the
  // messages), so when sending fails nothing is saved and the admin can simply try again.
  updateStatus(userId, accountStatus, beforeCommit) {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { userId }, data: { accountStatus } });
      if (accountStatus === 'suspended') {
        await tx.refreshToken.deleteMany({ where: { userId } });
      }
      await beforeCommit();
    });
  }

  // For scripts/create-admin.js.
  findByEmail(email) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async createAdmin({ firebaseUid, fullName, email }) {
    const user = await this.prisma.user.create({
      data: { firebaseUid, fullName, email, role: 'admin' },
      select: { userId: true },
    });
    return user.userId;
  }

  async updateFullName(userId, fullName) {
    await this.prisma.user.update({ where: { userId }, data: { fullName } });
  }
}
