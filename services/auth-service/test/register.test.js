import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { CnicEncryptor } from '../src/services/CnicEncryptor.js';
import { createTestContext, testConfig, validDoctor } from './helpers.js';

describe('POST /auth/doctor/register', () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  function register(body) {
    return request(ctx.app).post('/auth/doctor/register').send(body);
  }

  it('creates the Firebase user and the doctor, and returns 201', async () => {
    const res = await register({ ...validDoctor, email: ' Sara@Example.com ' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      userId: 1,
      message: 'Account created. Please verify your email before logging in.',
    });
    expect(ctx.firebaseClient.createUser).toHaveBeenCalledWith({
      email: 'sara@example.com',
      password: 'Secret@123',
      displayName: 'Dr. Sara Ahmed',
    });
    expect(ctx.users[0]).toMatchObject({
      firebaseUid: 'firebase-uid-1',
      email: 'sara@example.com',
      role: 'doctor',
      accountStatus: 'active',
    });
  });

  it('saves the CNIC encrypted, with a 64-character hash', async () => {
    await register(validDoctor);

    const profile = ctx.doctorProfiles[0];
    const encryptor = new CnicEncryptor({
      encryptionKey: testConfig.CNIC_ENCRYPTION_KEY,
      hashKey: testConfig.CNIC_HASH_KEY,
    });
    expect(profile.cnicEncrypted).not.toContain(validDoctor.cnic);
    expect(encryptor.decrypt(profile.cnicEncrypted)).toBe(validDoctor.cnic);
    expect(profile.cnicHash).toMatch(/^[0-9a-f]{64}$/);
    expect(profile.registrationNo).toBe('PMDC-12345');
  });

  it.each([
    ['a missing field', { ...validDoctor, fullName: undefined }],
    ['a wrong email', { ...validDoctor, email: 'not-an-email' }],
    ['a short password', { ...validDoctor, password: 'Ab@1234', confirmPassword: 'Ab@1234' }],
    ['a password with no uppercase letter', { ...validDoctor, password: 'secret@123', confirmPassword: 'secret@123' }],
    ['a password with no lowercase letter', { ...validDoctor, password: 'SECRET@123', confirmPassword: 'SECRET@123' }],
    ['a password with no number', { ...validDoctor, password: 'Secret@pass', confirmPassword: 'Secret@pass' }],
    ['a password with no special character', { ...validDoctor, password: 'Secret1234', confirmPassword: 'Secret1234' }],
    ['a password whose only symbol is not on the Firebase list (+)', { ...validDoctor, password: 'Secret+123', confirmPassword: 'Secret+123' }],
    ['the old example password', { ...validDoctor, password: '123456789', confirmPassword: '123456789' }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_, body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(ctx.firebaseClient.createUser).not.toHaveBeenCalled();
  });

  it.each(['352021234567', '35202-1234567-1', '35202123456AB'])(
    'returns 400 CNIC_INVALID for the CNIC %s',
    async (cnic) => {
      const res = await register({ ...validDoctor, cnic });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CNIC_INVALID');
    },
  );

  it('returns 400 PASSWORDS_DO_NOT_MATCH', async () => {
    const res = await register({ ...validDoctor, confirmPassword: 'Secret@124' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORDS_DO_NOT_MATCH');
  });

  it.each([
    ['EMAIL_TAKEN', { phone: '03000000001', cnic: '1111111111111', registrationNo: 'PMDC-1' }],
    ['PHONE_TAKEN', { email: 'other@example.com', cnic: '1111111111111', registrationNo: 'PMDC-1' }],
    ['CNIC_TAKEN', { email: 'other@example.com', phone: '03000000001', registrationNo: 'PMDC-1' }],
    ['REGISTRATION_NO_TAKEN', { email: 'other@example.com', phone: '03000000001', cnic: '1111111111111' }],
  ])('returns 409 %s when that value is already registered', async (code, changes) => {
    await register(validDoctor);

    const res = await register({ ...validDoctor, ...changes });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(code);
    expect(ctx.firebaseClient.createUser).toHaveBeenCalledTimes(1);
  });

  it('deletes the Firebase user and returns 500 SIGNUP_FAILED when the database save fails', async () => {
    ctx.userRepository.createUserWithProfile.mockRejectedValueOnce(new Error('connection lost'));

    const res = await register(validDoctor);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SIGNUP_FAILED');
    expect(ctx.firebaseClient.deleteUser).toHaveBeenCalledWith('firebase-uid-1');
    expect(ctx.users).toHaveLength(0);
  });
});
