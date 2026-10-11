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

// In-memory copies of the repositories, so the tests do not need a database.
function createFakeRepositories() {
  const users = [];
  const doctorProfiles = [];
  const refreshTokens = [];
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
      return [
        { specialtyId: 1, name: 'General Physician' },
        { specialtyId: 3, name: 'Cardiologist' },
      ];
    },
  };

  return { users, doctorProfiles, refreshTokens, userRepository, refreshTokenRepository, specialtyRepository };
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
  const app = createApp({
    logger: createLogger('test', 'silent'),
    config: testConfig,
    userRepository: fakes.userRepository,
    refreshTokenRepository: fakes.refreshTokenRepository,
    specialtyRepository: fakes.specialtyRepository,
    firebaseClient,
  });
  return { app, firebaseClient, ...fakes };
}
