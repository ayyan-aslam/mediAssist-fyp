import { createLogger } from '@mediassist/common';
import request from 'supertest';
import { createApp } from '../src/app.js';

export const DOCTOR_ID = 16;
export const OTHER_DOCTOR_ID = 17;

export const validPatient = {
  fullName: 'Bilal Hussain',
  phone: '03214567890',
  email: null,
  age: 45,
  gender: 'male',
};

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

// In-memory copies of the repositories, so the tests do not need a database.
// They keep the same doctor rules as the Prisma queries.
function createFakeRepositories() {
  const patients = [];
  const consultations = [];

  const phoneTaken = (doctorId, phone, exceptId) =>
    patients.some((p) => p.doctorId === doctorId && p.phone === phone && p.clinicalPatientId !== exceptId);

  const patientRepository = {
    async insert(doctorId, data) {
      if (phoneTaken(doctorId, data.phone)) throw uniqueViolation();
      const row = { clinicalPatientId: patients.length + 1, doctorId, ...data, createdAt: new Date() };
      patients.push(row);
      return row;
    },
    async findByDoctorAndPhone(doctorId, phone) {
      return patients.find((p) => p.doctorId === doctorId && p.phone === phone) ?? null;
    },
    async findByDoctorAndId(doctorId, id) {
      return patients.find((p) => p.doctorId === doctorId && p.clinicalPatientId === id) ?? null;
    },
    async update(doctorId, id, changes) {
      const row = patients.find((p) => p.doctorId === doctorId && p.clinicalPatientId === id);
      if (!row) return false;
      if (changes.phone && phoneTaken(doctorId, changes.phone, id)) throw uniqueViolation();
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) row[key] = value;
      }
      return true;
    },
  };

  const patientOf = (consultation) => patients.find((p) => p.clinicalPatientId === consultation.clinicalPatientId);

  const consultationRepository = {
    async create({ clinicalPatientId, status, startedAt }) {
      const row = {
        consultationId: consultations.length + 1,
        clinicalPatientId,
        status,
        soapAttempt: 1,
        aiRequestedAt: null,
        failureReason: null,
        followUpDate: null,
        startedAt,
        endedAt: null,
      };
      consultations.push(row);
      return row;
    },
    async findByDoctorAndId(doctorId, id) {
      const row = consultations.find((c) => c.consultationId === id);
      const patient = row && patientOf(row);
      if (!row || patient.doctorId !== doctorId) return null;
      const { clinicalPatientId, fullName, phone } = patient;
      return { ...row, clinicalPatient: { clinicalPatientId, fullName, phone } };
    },
    async findPatientContact(id) {
      const row = consultations.find((c) => c.consultationId === id);
      if (!row) return null;
      const { fullName, age, gender, phone, email } = patientOf(row);
      return { clinicalPatient: { fullName, age, gender, phone, email } };
    },
  };

  return { patients, consultations, patientRepository, consultationRepository };
}

export function createTestContext() {
  const fakes = createFakeRepositories();
  const app = createApp({
    logger: createLogger('test', 'silent'),
    patientRepository: fakes.patientRepository,
    consultationRepository: fakes.consultationRepository,
  });

  // A request with the headers the API Gateway adds after it checks the token and the role.
  const as = (doctorId = DOCTOR_ID, role = 'doctor') => ({
    get: (url) => request(app).get(url).set('x-user-id', String(doctorId)).set('x-user-role', role),
    post: (url) => request(app).post(url).set('x-user-id', String(doctorId)).set('x-user-role', role),
    patch: (url) => request(app).patch(url).set('x-user-id', String(doctorId)).set('x-user-role', role),
  });

  return { app, as, ...fakes };
}
