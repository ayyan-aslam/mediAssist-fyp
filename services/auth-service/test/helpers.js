import crypto from 'node:crypto';
import { createLogger } from '@mediassist/common';
import { vi } from 'vitest';
import { createApp } from '../src/app.js';

export const testConfig = {
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
  CNIC_ENCRYPTION_KEY: crypto.randomBytes(32),
  CNIC_HASH_KEY: crypto.randomBytes(32),
};

export const validDoctor = {
  fullName: 'Dr. Sara Ahmed',
  email: 'sara@example.com',
  phone: '03111234567',
  cnic: '3520212345671',
  registrationNo: 'PMDC-12345',
  password: 'Secret@123',
  confirmPassword: 'Secret@123',
};

// The Prisma error for a value that a unique index refused (shape from @prisma/adapter-pg).
export function uniqueViolation(index) {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { driverAdapterError: { cause: { kind: 'UniqueConstraintViolation', constraint: { index } } } },
  });
}

// In-memory copies of the repositories, so the tests do not need a database.
function createFakeRepositories() {
  const users = [];
  const doctorProfiles = [];
  const patientProfiles = [];
  const refreshTokens = [];
  const specialties = [
    { specialtyId: 1, name: 'General Physician' },
    { specialtyId: 3, name: 'Cardiologist' },
  ];
  let nextTokenId = 1;

  const userRepository = {
    async findDuplicates({ email, phone, cnicHash, registrationNo }) {
      const taken = [];
      if (users.some((user) => user.email === email)) taken.push('email');
      if (phone && users.some((user) => user.phone === phone)) taken.push('phone');
      if (cnicHash && doctorProfiles.some((doctor) => doctor.cnicHash === cnicHash)) taken.push('cnic');
      if (registrationNo && doctorProfiles.some((doctor) => doctor.registrationNo === registrationNo)) {
        taken.push('registrationNo');
      }
      return taken;
    },
    createUserWithProfile: vi.fn(async ({ firebaseUid, fullName, email, phone, role, profile }) => {
      const userId = users.length + 1;
      users.push({ userId, firebaseUid, fullName, email, phone, role, accountStatus: 'active' });
      if (role === 'doctor') doctorProfiles.push({ userId, ...profile });
      return userId;
    }),
    async findByFirebaseUid(firebaseUid) {
      return users.find((user) => user.firebaseUid === firebaseUid) ?? null;
    },
    async findById(userId) {
      return users.find((user) => user.userId === userId) ?? null;
    },
    async findByPhone(phone) {
      return users.find((user) => user.phone === phone) ?? null;
    },
    async findProfileById(userId) {
      const user = users.find((item) => item.userId === userId);
      if (!user) return null;
      const doctor = doctorProfiles.find((item) => item.userId === userId);
      const patient = patientProfiles.find((item) => item.userId === userId);
      return {
        userId: user.userId,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        patientProfile: patient ? { dateOfBirth: patient.dateOfBirth ?? null, gender: patient.gender ?? null } : null,
        doctorProfile: doctor
          ? {
              registrationNo: doctor.registrationNo,
              specialty: specialties.find((item) => item.specialtyId === doctor.specialtyId) ?? null,
            }
          : null,
      };
    },
    updateProfile: vi.fn(async (userId, role, { fullName, phone, profile }) => {
      const user = users.find((item) => item.userId === userId);
      if (fullName !== undefined) user.fullName = fullName;
      if (phone !== undefined) user.phone = phone;
      const profiles = role === 'doctor' ? doctorProfiles : patientProfiles;
      let row = profiles.find((item) => item.userId === userId);
      if (!row) {
        row = { userId };
        profiles.push(row);
      }
      for (const [key, value] of Object.entries(profile)) {
        if (value !== undefined) row[key] = value;
      }
    }),
  };

  const refreshTokenRepository = {
    async save(data) {
      refreshTokens.push({ tokenId: nextTokenId++, ...data });
    },
    async findByHash(tokenHash) {
      return refreshTokens.find((token) => token.tokenHash === tokenHash) ?? null;
    },
    async replace(oldTokenId, data) {
      const index = refreshTokens.findIndex((token) => token.tokenId === oldTokenId);
      if (index === -1) return false;
      refreshTokens.splice(index, 1);
      refreshTokens.push({ tokenId: nextTokenId++, ...data });
      return true;
    },
    async deleteByHash(tokenHash) {
      const index = refreshTokens.findIndex((token) => token.tokenHash === tokenHash);
      if (index !== -1) refreshTokens.splice(index, 1);
    },
  };

  const specialtyRepository = {
    async findAll() {
      return specialties;
    },
    async findById(specialtyId) {
      return specialties.find((item) => item.specialtyId === specialtyId) ?? null;
    },
  };

  return { users, doctorProfiles, patientProfiles, refreshTokens, userRepository, refreshTokenRepository, specialtyRepository };
}

function createFirebaseMock() {
  let nextUid = 1;
  return {
    createUser: vi.fn(async () => `firebase-uid-${nextUid++}`),
    deleteUser: vi.fn(async () => {}),
    verifyIdToken: vi.fn(async () => {
      throw new Error('Firebase ID token has invalid signature');
    }),
  };
}

export function createTestContext() {
  const fakes = createFakeRepositories();
  const firebaseClient = createFirebaseMock();
  const eventPublisher = { publish: vi.fn(async () => {}) };
  const app = createApp({
    logger: createLogger('test', 'silent'),
    config: testConfig,
    userRepository: fakes.userRepository,
    refreshTokenRepository: fakes.refreshTokenRepository,
    specialtyRepository: fakes.specialtyRepository,
    eventPublisher,
    firebaseClient,
  });
  return { app, firebaseClient, eventPublisher, ...fakes };
}
