// Checks the Prisma queries, the check rules and the cascade against the real ConsultationDB (Docker).
// Skipped when CONSULTATION_DATABASE_URL is not set. Run the migrations first (npm run db:migrate).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/prisma.js';
import { ConsultationRepository } from '../src/repositories/ConsultationRepository.js';
import { PatientRepository } from '../src/repositories/PatientRepository.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: use the variables that are already set.
}

const databaseUrl = process.env.CONSULTATION_DATABASE_URL;
// Doctor IDs that no real doctor has, so the rows made here can be removed afterwards.
const doctorId = -crypto.randomInt(1e6, 1e9);
const otherDoctorId = doctorId - 1;

const newPatient = (phone) => ({ fullName: 'بلال حسین', phone, email: null, age: 45, gender: 'male' });

describe.skipIf(!databaseUrl)('repositories (database)', () => {
  let prisma;
  let patients;
  let consultations;

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl);
    patients = new PatientRepository(prisma);
    consultations = new ConsultationRepository(prisma);
  });

  afterAll(async () => {
    const mine = { clinicalPatient: { doctorId: { in: [doctorId, otherDoctorId] } } };
    await prisma.consultation.deleteMany({ where: mine });
    await prisma.clinicalPatient.deleteMany({ where: { doctorId: { in: [doctorId, otherDoctorId] } } });
    await prisma.$disconnect();
  });

  it('saves a patient with an Urdu name and finds it only for its doctor', async () => {
    const saved = await patients.insert(doctorId, newPatient('03000000001'));

    expect(saved.fullName).toBe('بلال حسین');
    expect(await patients.findByDoctorAndPhone(doctorId, '03000000001')).toMatchObject({ clinicalPatientId: saved.clinicalPatientId });
    expect(await patients.findByDoctorAndPhone(otherDoctorId, '03000000001')).toBeNull();
    expect(await patients.findByDoctorAndId(otherDoctorId, saved.clinicalPatientId)).toBeNull();
  });

  it('throws P2002 when one doctor saves the same phone twice, but not for two doctors', async () => {
    await patients.insert(doctorId, newPatient('03000000002'));

    await expect(patients.insert(doctorId, newPatient('03000000002'))).rejects.toMatchObject({ code: 'P2002' });
    await expect(patients.insert(otherDoctorId, newPatient('03000000002'))).resolves.toBeDefined();
  });

  it('updates only the doctor’s own patient', async () => {
    const saved = await patients.insert(doctorId, newPatient('03000000003'));

    expect(await patients.update(otherDoctorId, saved.clinicalPatientId, { age: 50 })).toBe(false);
    expect(await patients.update(doctorId, saved.clinicalPatientId, { age: 46, email: 'b@example.com' })).toBe(true);
    expect(await patients.findByDoctorAndId(doctorId, saved.clinicalPatientId)).toMatchObject({ age: 46, email: 'b@example.com' });
  });

  it('rejects values outside the check rules', async () => {
    await expect(patients.insert(doctorId, { ...newPatient('03000000004'), age: 121 })).rejects.toThrow();
    await expect(patients.insert(doctorId, { ...newPatient('03000000005'), gender: 'x' })).rejects.toThrow();

    const patient = await patients.insert(doctorId, newPatient('03000000006'));
    const consultation = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });
    const where = { consultationId: consultation.consultationId };
    await expect(prisma.consultation.update({ where, data: { status: 'paused' } })).rejects.toThrow();
    await expect(prisma.consultation.update({ where, data: { soapAttempt: 0 } })).rejects.toThrow();
    await expect(prisma.consultation.update({ where, data: { failureReason: 'AI_TIMEOUT' } })).rejects.toThrow();
    await expect(
      prisma.consultation.update({ where, data: { status: 'failed', failureReason: 'OTHER' } }),
    ).rejects.toThrow();
    await expect(
      prisma.consultation.update({ where, data: { status: 'failed', failureReason: 'AI_TIMEOUT' } }),
    ).resolves.toMatchObject({ failureReason: 'AI_TIMEOUT' });
  });

  it('creates a consultation with soap_attempt 1 and finds it only for its doctor', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000007'));
    const created = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });

    expect(created).toMatchObject({ status: 'recording', soapAttempt: 1, failureReason: null, aiRequestedAt: null });
    expect(await consultations.findByDoctorAndId(doctorId, created.consultationId)).toMatchObject({
      clinicalPatient: { clinicalPatientId: patient.clinicalPatientId, fullName: 'بلال حسین', phone: '03000000007' },
    });
    expect(await consultations.findByDoctorAndId(otherDoctorId, created.consultationId)).toBeNull();
    expect(await consultations.findPatientContact(created.consultationId)).toEqual({
      clinicalPatient: { fullName: 'بلال حسین', age: 45, gender: 'male', phone: '03000000007', email: null },
    });
  });

  it('saves the AI result in ai_result exactly as it was sent', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000009'));
    const { consultationId } = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'processing',
      startedAt: new Date(),
    });
    const aiResult = {
      soap: { subjective: 'Gala kharab ae 3 dinan ton', objective: null },
      prescription: [{ name: 'Panadol', strength: '500 mg', dose: '1 tablet', notes: 'کھانے کے بعد' }],
      warnings: [],
    };

    await prisma.soapNote.create({ data: { consultationId, plan: 'Rest', aiResult } });

    expect((await prisma.soapNote.findUnique({ where: { consultationId } })).aiResult).toEqual(aiResult);
  });

  it('deletes the audio parts, transcript windows and SOAP note with their consultation', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000008'));
    const { consultationId } = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });
    await prisma.audioPart.create({
      data: { consultationId, partNo: 1, fileKey: `test/${consultationId}/1.webm`, durationSec: 10, recordedAt: new Date() },
    });
    await prisma.transcriptWindow.create({ data: { consultationId, windowNo: 1, status: 'pending' } });
    await prisma.soapNote.create({ data: { consultationId, plan: 'Rest' } });

    await prisma.consultation.delete({ where: { consultationId } });

    expect(await prisma.audioPart.count({ where: { consultationId } })).toBe(0);
    expect(await prisma.transcriptWindow.count({ where: { consultationId } })).toBe(0);
    expect(await prisma.soapNote.count({ where: { consultationId } })).toBe(0);
  });
});
