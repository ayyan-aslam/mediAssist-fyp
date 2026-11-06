import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, validDoctor } from './helpers.js';

const otherDoctor = {
  ...validDoctor,
  fullName: 'Dr. Bilal Shah',
  email: 'bilal@example.com',
  phone: '03221234567',
  cnic: '3520298765431',
  registrationNo: 'PMDC-67890',
};

describe('profile', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await request(ctx.app).post('/auth/doctor/register').send(validDoctor);
    await request(ctx.app).post('/auth/doctor/register').send(otherDoctor);
  });

  // The headers the API Gateway adds after it checks the token.
  function asUser(req, userId = 1, role = 'doctor') {
    return req.set('x-user-id', String(userId)).set('x-user-role', role);
  }

  function getMe(userId, role) {
    return asUser(request(ctx.app).get('/users/me'), userId, role);
  }

  function patchMe(body, userId, role) {
    return asUser(request(ctx.app).patch('/users/me'), userId, role).send(body);
  }

  function addPatient() {
    ctx.users.push({
      userId: 3,
      firebaseUid: 'firebase-uid-3',
      fullName: 'Ali Khan',
      email: 'ali@example.com',
      phone: null,
      role: 'patient',
      accountStatus: 'active',
    });
  }

  describe('GET /users/me', () => {
    it('returns the doctor profile without the CNIC', async () => {
      const res = await getMe();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 1,
        fullName: 'Dr. Sara Ahmed',
        email: 'sara@example.com',
        phone: '03111234567',
        role: 'doctor',
        registrationNo: 'PMDC-12345',
        specialty: null,
      });
      expect(JSON.stringify(res.body)).not.toContain(validDoctor.cnic);
    });

    it('returns a patient profile with empty fields as null', async () => {
      addPatient();
      const res = await getMe(3, 'patient');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 3,
        fullName: 'Ali Khan',
        email: 'ali@example.com',
        phone: null,
        role: 'patient',
        dateOfBirth: null,
        gender: null,
      });
    });

    it('returns 401 without the gateway user headers', async () => {
      const res = await request(ctx.app).get('/users/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 USER_NOT_FOUND when the user no longer exists', async () => {
      const res = await getMe(99);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('PATCH /users/me', () => {
    it('changes the name, phone and speciality of the doctor', async () => {
      const res = await patchMe({ fullName: 'Dr. Sara Ahmed Khan', phone: '03119876543', specialtyId: 3 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 1,
        fullName: 'Dr. Sara Ahmed Khan',
        email: 'sara@example.com',
        phone: '03119876543',
        role: 'doctor',
        registrationNo: 'PMDC-12345',
        specialty: { specialtyId: 3, name: 'Cardiologist' },
      });
      expect((await getMe()).body).toEqual(res.body);
    });

    it('changes only the fields that are sent', async () => {
      const res = await patchMe({ specialtyId: 1 });

      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe('Dr. Sara Ahmed');
      expect(res.body.phone).toBe('03111234567');
      expect(res.body.specialty).toEqual({ specialtyId: 1, name: 'General Physician' });
    });

    it('keeps an Urdu name as it is', async () => {
      const res = await patchMe({ fullName: 'ڈاکٹر سارہ احمد' });
      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe('ڈاکٹر سارہ احمد');
    });

    it('accepts the doctor’s own current phone', async () => {
      const res = await patchMe({ phone: validDoctor.phone });
      expect(res.status).toBe(200);
    });

    it('returns 409 PHONE_TAKEN when the phone belongs to another user', async () => {
      const res = await patchMe({ phone: otherDoctor.phone });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'PHONE_TAKEN', message: 'This phone number is already registered.' },
      });
      expect(ctx.userRepository.updateProfile).not.toHaveBeenCalled();
    });

    it('returns 400 VALIDATION_ERROR for a speciality that does not exist', async () => {
      const res = await patchMe({ specialtyId: 42 });

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'specialtyId: this speciality does not exist.',
      });
      expect(ctx.userRepository.updateProfile).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty name', { fullName: '  ' }],
      ['a wrong phone', { phone: '12ab' }],
      ['a text specialtyId', { specialtyId: '3' }],
      ['a field the doctor cannot change', { email: 'new@example.com' }],
      ['the CNIC', { cnic: '3520212345671' }],
      ['a patient field', { gender: 'female' }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, body) => {
      const res = await patchMe(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(ctx.userRepository.updateProfile).not.toHaveBeenCalled();
    });

    it('lets a patient set the date of birth and gender', async () => {
      addPatient();
      const res = await patchMe({ dateOfBirth: '1998-04-12', gender: 'male' }, 3, 'patient');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ userId: 3, role: 'patient', dateOfBirth: '1998-04-12', gender: 'male' });
    });

    it('returns 403 for an admin', async () => {
      const res = await patchMe({ fullName: 'Admin' }, 1, 'admin');
      expect(res.status).toBe(403);
      expect(ctx.userRepository.updateProfile).not.toHaveBeenCalled();
    });

    it('returns 401 without the gateway user headers', async () => {
      const res = await request(ctx.app).patch('/users/me').send({ fullName: 'X' });
      expect(res.status).toBe(401);
    });
  });
});
