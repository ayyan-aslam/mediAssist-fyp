// Checks the Prisma queries against the real UserDB (Docker).
// Skipped when AUTH_DATABASE_URL is not set. Run the migrations first (npm run db:migrate).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/prisma.js';
import { RefreshTokenRepository } from '../src/repositories/RefreshTokenRepository.js';
import { SpecialtyRepository } from '../src/repositories/SpecialtyRepository.js';
import { takenField, UserRepository } from '../src/repositories/UserRepository.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: use the variables that are already set.
}

const databaseUrl = process.env.AUTH_DATABASE_URL;
// Every row made here has this prefix, so it can be removed afterwards.
const prefix = `test-${crypto.randomBytes(4).toString('hex')}`;

function newDoctor(suffix) {
  return {
    firebaseUid: `${prefix}-${suffix}`,
    fullName: 'Dr. Test',
    email: `${prefix}-${suffix}@example.com`,
    phone: `0${crypto.randomInt(1e9, 1e10)}`,
    role: 'doctor',
    profile: {
      cnicEncrypted: 'encrypted',
      cnicHash: crypto.randomBytes(32).toString('hex'),
      registrationNo: `${prefix}-${suffix}`,
    },
  };
}

describe.skipIf(!databaseUrl)('repositories (database)', () => {
  let prisma;
  let users;
  let tokens;

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl);
    users = new UserRepository(prisma);
    tokens = new RefreshTokenRepository(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it('saves a doctor and finds every duplicate field', async () => {
    const doctor = newDoctor('a');
    const userId = await users.createUserWithProfile(doctor);

    expect(await users.findById(userId)).toMatchObject({ email: doctor.email, accountStatus: 'active' });
    expect(await users.findByFirebaseUid(doctor.firebaseUid)).toMatchObject({ userId });
    expect(
      await users.findDuplicates({
        email: doctor.email,
        phone: doctor.phone,
        cnicHash: doctor.profile.cnicHash,
        registrationNo: doctor.profile.registrationNo,
      }),
    ).toEqual(['email', 'phone', 'cnic', 'registrationNo']);
  });

  it('saves nothing when the profile insert fails', async () => {
    const first = newDoctor('b');
    await users.createUserWithProfile(first);
    const second = newDoctor('c');
    second.profile.registrationNo = first.profile.registrationNo;

    await expect(users.createUserWithProfile(second)).rejects.toThrow();
    expect(await users.findByFirebaseUid(second.firebaseUid)).toBeNull();
  });

  it('replaces a refresh token only once', async () => {
    const userId = await users.createUserWithProfile(newDoctor('d'));
    const expiresAt = new Date(Date.now() + 60_000);
    const oldHash = crypto.randomBytes(32).toString('hex');
    await tokens.save({ userId, tokenHash: oldHash, expiresAt });
    const old = await tokens.findByHash(oldHash);

    const newHash = crypto.randomBytes(32).toString('hex');
    expect(await tokens.replace(old.tokenId, { userId, tokenHash: newHash, expiresAt })).toBe(true);
    expect(await tokens.replace(old.tokenId, { userId, tokenHash: 'x'.repeat(64), expiresAt })).toBe(false);
    expect(await tokens.findByHash(oldHash)).toBeNull();

    await tokens.deleteByHash(newHash);
    expect(await tokens.findByHash(newHash)).toBeNull();
  });

  it('updates and reads a doctor profile without the CNIC', async () => {
    const doctor = newDoctor('e');
    const userId = await users.createUserWithProfile(doctor);
    const [specialty] = await new SpecialtyRepository(prisma).findAll();
    const phone = `0${crypto.randomInt(1e9, 1e10)}`;

    await users.updateProfile(userId, 'doctor', {
      fullName: 'Dr. Updated',
      phone,
      profile: { specialtyId: specialty.specialtyId },
    });

    expect(await users.findProfileById(userId)).toEqual({
      userId,
      fullName: 'Dr. Updated',
      email: doctor.email,
      phone,
      role: 'doctor',
      patientProfile: null,
      doctorProfile: { registrationNo: doctor.profile.registrationNo, specialty },
    });
    expect(await users.findByPhone(phone)).toMatchObject({ userId });
    expect(await new SpecialtyRepository(prisma).findById(specialty.specialtyId)).toEqual(specialty);
  });

  it('names the field when two users save the same phone at the same moment', async () => {
    const first = await users.createUserWithProfile(newDoctor('f'));
    const second = await users.createUserWithProfile(newDoctor('g'));
    const phone = `0${crypto.randomInt(1e9, 1e10)}`;
    const save = (userId) => users.updateProfile(userId, 'doctor', { phone, profile: {} });

    const results = await Promise.allSettled([save(first), save(second)]);

    const failed = results.filter((result) => result.status === 'rejected');
    expect(failed).toHaveLength(1);
    expect(takenField(failed[0].reason)).toBe('phone');
  });

  it('names the field when two doctors sign up with the same registration number at the same moment', async () => {
    const first = newDoctor('h');
    const second = { ...newDoctor('i'), profile: { ...newDoctor('i').profile, registrationNo: first.profile.registrationNo } };

    const results = await Promise.allSettled([users.createUserWithProfile(first), users.createUserWithProfile(second)]);

    const failed = results.filter((result) => result.status === 'rejected');
    expect(failed).toHaveLength(1);
    expect(takenField(failed[0].reason)).toBe('registrationNo');
    expect(takenField(new Error('connection lost'))).toBeNull();
  });

  it('lists the specialities', async () => {
    const items = await new SpecialtyRepository(prisma).findAll();
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(Object.keys(item)).toEqual(['specialtyId', 'name']);
    }
  });
  it('searches users by part of the name, email or phone, with filters and pages, without the CNIC', async () => {
    const doctor = newDoctor('search');
    doctor.fullName = `Dr. ${prefix} Zainab`;
    const userId = await users.createUserWithProfile(doctor);
    const page = { page: 1, pageSize: 20 };

    for (const search of [prefix.toUpperCase(), 'zainab', doctor.phone.slice(3, 9), `${prefix}-search@`]) {
      const { items } = await users.findAdminPage({ search }, page);
      expect(items.map((item) => item.userId)).toContain(userId);
    }
    const { items, total } = await users.findAdminPage({ search: `${prefix}-search`, role: 'doctor', status: 'active' }, page);
    expect(total).toBe(1);
    expect(items[0]).toEqual({
      userId,
      fullName: doctor.fullName,
      email: doctor.email,
      phone: doctor.phone,
      role: 'doctor',
      accountStatus: 'active',
      createdAt: expect.any(Date),
      doctorProfile: { specialty: null },
    });
    expect((await users.findAdminPage({ search: `${prefix}-search`, role: 'patient' }, page)).total).toBe(0);
    expect((await users.findAdminPage({ search: `${prefix}-search`, status: 'suspended' }, page)).total).toBe(0);
    expect(await users.findAdminUserById(userId)).toEqual(items[0]);
    expect(await users.findNamesByIds([userId, 2_000_000_000])).toEqual([
      { userId, fullName: doctor.fullName, role: 'doctor' },
    ]);
  });

  it('uses the trigram indexes for a partial search on name, email and phone', async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe(
        "EXPLAIN SELECT user_id FROM users WHERE full_name ILIKE '%sara%' OR email ILIKE '%sara%' OR phone LIKE '%4567%'",
      );
    });
    const text = plan.map((row) => row['QUERY PLAN']).join(' ');
    for (const index of ['users_full_name_trgm_idx', 'users_email_trgm_idx', 'users_phone_trgm_idx']) {
      expect(text).toContain(index);
    }
  });

  it('suspends a user and deletes all their refresh tokens in one transaction', async () => {
    const userId = await users.createUserWithProfile(newDoctor('suspend'));
    const expiresAt = new Date(Date.now() + 60_000);
    for (let i = 0; i < 2; i += 1) {
      await tokens.save({ userId, tokenHash: crypto.randomBytes(32).toString('hex'), expiresAt });
    }

    // Sending the messages fails: nothing is saved.
    await expect(
      users.updateStatus(userId, 'suspended', async () => {
        throw new Error('RabbitMQ is not connected.');
      }),
    ).rejects.toThrow('RabbitMQ');
    expect((await users.findById(userId)).accountStatus).toBe('active');
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(2);

    await users.updateStatus(userId, 'suspended', async () => {});
    expect((await users.findById(userId)).accountStatus).toBe('suspended');
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(0);

    await users.updateStatus(userId, 'active', async () => {});
    expect((await users.findById(userId)).accountStatus).toBe('active');
  });
});
