// Checks the Prisma queries against the real UserDB (Docker).
// Skipped when AUTH_DATABASE_URL is not set. Run the migrations first (npm run db:migrate).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/prisma.js';
import { RefreshTokenRepository } from '../src/repositories/RefreshTokenRepository.js';
import { SpecialtyRepository } from '../src/repositories/SpecialtyRepository.js';
import { UserRepository } from '../src/repositories/UserRepository.js';

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

  it('lists the specialities', async () => {
    const items = await new SpecialtyRepository(prisma).findAll();
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(Object.keys(item)).toEqual(['specialtyId', 'name']);
    }
  });
});
