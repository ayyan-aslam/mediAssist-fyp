// Checks the Prisma queries, the check rules and the cascade against the real ConsultationDB (Docker).
// Skipped when CONSULTATION_DATABASE_URL is not set. Run the migrations first (npm run db:migrate).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/prisma.js';
import { ConsultationRepository } from '../src/repositories/ConsultationRepository.js';
import { PatientRepository } from '../src/repositories/PatientRepository.js';
import { SoapNoteRepository } from '../src/repositories/SoapNoteRepository.js';
import { TranscriptRepository } from '../src/repositories/TranscriptRepository.js';

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
  let transcripts;
  let soapNotes;

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl);
    patients = new PatientRepository(prisma);
    consultations = new ConsultationRepository(prisma);
    transcripts = new TranscriptRepository(prisma);
    soapNotes = new SoapNoteRepository(prisma);
  });

  let nextPhone = 100;
  async function newConsultation(status = 'processing') {
    nextPhone += 1;
    const patient = await patients.insert(doctorId, newPatient(`030000${String(nextPhone).padStart(5, '0')}`));
    return consultations.create({ clinicalPatientId: patient.clinicalPatientId, status, startedAt: new Date() });
  }
  const read = (consultationId) => prisma.consultation.findUnique({ where: { consultationId } });

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

  it('saves an audio part once and counts the parts of a minute', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000010'));
    const { consultationId } = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });
    const part = (partNo) => ({ consultationId, partNo, fileKey: `test/${consultationId}/${partNo}.webm`, durationSec: 10 });

    await consultations.savePart(part(1));
    await consultations.savePart(part(6));
    await consultations.savePart(part(7));

    await expect(consultations.savePart(part(1))).rejects.toMatchObject({ code: 'P2002' });
    expect(await consultations.findPart(consultationId, 1)).toMatchObject({ fileKey: `test/${consultationId}/1.webm` });
    expect(await consultations.findPart(consultationId, 2)).toBeNull();
    expect(await consultations.countPartsInRange(consultationId, 1, 6)).toBe(2);
  });

  it('creates a pending transcript window only once, even when asked at the same time', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000011'));
    const { consultationId } = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });

    const created = await Promise.all([
      transcripts.createPendingWindow(consultationId, 1),
      transcripts.createPendingWindow(consultationId, 1),
    ]);

    expect(created.sort()).toEqual([false, true]);
    expect(await prisma.transcriptWindow.findMany({ where: { consultationId } })).toEqual([
      expect.objectContaining({ windowNo: 1, status: 'pending', transcriptText: null }),
    ]);

    await transcripts.deleteWindow(consultationId, 1);
    expect(await transcripts.createPendingWindow(consultationId, 1)).toBe(true);
  });

  it('finds the parts of a range in play order', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000012'));
    const { consultationId } = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });
    for (const partNo of [8, 6, 7, 13]) {
      await consultations.savePart({ consultationId, partNo, fileKey: `test/${consultationId}/${partNo}.webm`, durationSec: 10 });
    }

    const parts = await consultations.findPartsInRange(consultationId, 6, 12);

    expect(parts.map((p) => p.partNo)).toEqual([6, 7, 8]);
    expect(parts[0].fileKey).toBe(`test/${consultationId}/6.webm`);
  });

  it('saves the text of a window as done in UTF-8, and marks a window failed', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000013'));
    const { consultationId } = await consultations.create({
      clinicalPatientId: patient.clinicalPatientId,
      status: 'recording',
      startedAt: new Date(),
    });
    await transcripts.createPendingWindow(consultationId, 1);
    await transcripts.createPendingWindow(consultationId, 2);
    const text = 'Doctor: Kya masla hai?\nPatient: 3 dinan ton gala kharab ae – سر میں درد';

    await transcripts.saveText(consultationId, 1, text);
    await transcripts.updateStatus(consultationId, 2, 'failed');

    expect(await transcripts.findWindow(consultationId, 1)).toMatchObject({ status: 'done', transcriptText: text });
    expect(await transcripts.findWindow(consultationId, 2)).toMatchObject({ status: 'failed', transcriptText: null });
    expect(await transcripts.findWindow(consultationId, 3)).toBeNull();
    await expect(transcripts.updateStatus(consultationId, 2, 'unknown')).rejects.toThrow();
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

  it('stops a recording once and lists the saved part numbers', async () => {
    const { consultationId } = await newConsultation('recording');
    for (const partNo of [3, 1, 2]) {
      await consultations.savePart({ consultationId, partNo, fileKey: `test/${consultationId}/${partNo}.webm`, durationSec: 10 });
    }
    const endedAt = new Date();

    expect(await consultations.findSavedPartNos(consultationId)).toEqual([1, 2, 3]);
    expect(await consultations.countParts(consultationId)).toBe(3);
    const both = await Promise.all([
      consultations.markProcessing(consultationId, endedAt),
      consultations.markProcessing(consultationId, endedAt),
    ]);
    expect(both.sort()).toEqual([false, true]);
    expect(await read(consultationId)).toMatchObject({ status: 'processing', endedAt });
  });

  it('starts a retry only from failed: next attempt, failure reason and ai_requested_at cleared', async () => {
    const { consultationId } = await newConsultation('processing');
    expect(await consultations.startRetry(consultationId)).toBe(false);
    await prisma.consultation.update({
      where: { consultationId },
      data: { status: 'failed', failureReason: 'AI_TIMEOUT', aiRequestedAt: new Date() },
    });

    expect(await consultations.startRetry(consultationId)).toBe(true);
    expect(await read(consultationId)).toMatchObject({
      status: 'processing',
      soapAttempt: 2,
      failureReason: null,
      aiRequestedAt: null,
    });
  });

  it('reads the consultation details for the AI Pipeline messages', async () => {
    const { consultationId, clinicalPatientId } = await newConsultation('processing');
    for (const [partNo, durationSec] of [[1, 10], [2, 10], [3, 4], [4, 10]]) {
      await consultations.savePart({ consultationId, partNo, fileKey: `test/${consultationId}/${partNo}.webm`, durationSec });
    }

    expect(await soapNotes.findConsultation(consultationId)).toEqual({
      consultationId,
      status: 'processing',
      soapAttempt: 1,
      hasNote: false,
      doctorId,
      clinicalPatientId,
      patientAge: 45,
      patientGender: 'male',
    });
    expect(await soapNotes.getDurationSec(consultationId, 3)).toBe(24);
    expect(await soapNotes.findConsultation(2_000_000_000)).toBeNull();
  });

  it('saves the SOAP note and sets completed in one transaction, only for the current attempt and once', async () => {
    const { consultationId } = await newConsultation('processing');
    await prisma.consultation.update({ where: { consultationId }, data: { soapAttempt: 2 } });
    const aiResult = { schema_version: '1.0', soap: { objective: null }, warnings: ['کھانے کے بعد'] };
    const note = { subjective: 'Gala kharab', objective: '', assessment: 'Viral', plan: 'Panadol 500 mg', aiResult };

    expect(await soapNotes.saveSoapNote(consultationId, 1, note)).toBeNull();
    expect((await read(consultationId)).status).toBe('processing');

    const results = await Promise.all([
      soapNotes.saveSoapNote(consultationId, 2, note),
      soapNotes.saveSoapNote(consultationId, 2, { ...note, plan: 'Other' }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await read(consultationId)).status).toBe('completed');
    const saved = await prisma.soapNote.findUnique({ where: { consultationId } });
    expect(saved.aiResult).toEqual(aiResult);
    expect((await soapNotes.findConsultation(consultationId)).hasNote).toBe(true);
  });

  it('marks failed only while processing, and only for the given attempt', async () => {
    const { consultationId } = await newConsultation('processing');

    expect(await soapNotes.markFailed(consultationId, 'AI_FAILED', 2)).toBeNull();
    expect(await soapNotes.markFailed(consultationId, 'AI_FAILED', 1)).toEqual({ consultationId, doctorId });
    expect(await read(consultationId)).toMatchObject({ status: 'failed', failureReason: 'AI_FAILED' });
    expect(await soapNotes.markFailed(consultationId, 'TRANSCRIPTION_FAILED')).toBeNull();
  });

  it('sets ai_requested_at only for the current attempt while processing', async () => {
    const { consultationId } = await newConsultation('processing');
    const at = new Date();

    expect(await soapNotes.setAiRequestedAt(consultationId, 2, at)).toBe(false);
    expect(await soapNotes.setAiRequestedAt(consultationId, 1, at)).toBe(true);
    expect((await read(consultationId)).aiRequestedAt).toEqual(at);
  });

  it('times out only the consultations that waited too long, in one UPDATE ... RETURNING', async () => {
    const old = await newConsultation('processing');
    const recent = await newConsultation('processing');
    const notSent = await newConsultation('processing');
    await soapNotes.setAiRequestedAt(old.consultationId, 1, new Date(Date.now() - 120_000));
    await soapNotes.setAiRequestedAt(recent.consultationId, 1, new Date());

    const rows = await soapNotes.markTimedOut(new Date(Date.now() - 60_000));

    expect(rows.filter((row) => row.doctorId === doctorId)).toEqual([{ consultationId: old.consultationId, doctorId }]);
    expect(await read(old.consultationId)).toMatchObject({ status: 'failed', failureReason: 'AI_TIMEOUT' });
    expect((await read(recent.consultationId)).status).toBe('processing');
    expect((await read(notSent.consultationId)).status).toBe('processing');
  });

  it('reads and updates a SOAP note only for its doctor, saving only the sent parts', async () => {
    const { consultationId } = await newConsultation('completed');
    expect(await soapNotes.findSoapNote(consultationId, doctorId)).toEqual({ soapNote: null });
    expect(await soapNotes.update(consultationId, doctorId, { plan: 'x' })).toBeNull();
    const created = await prisma.soapNote.create({
      data: { consultationId, subjective: 'S', objective: 'O', assessment: 'A', plan: 'P', aiResult: { a: 1 } },
    });

    expect(await soapNotes.findSoapNote(consultationId, otherDoctorId)).toBeNull();
    expect(await soapNotes.update(consultationId, otherDoctorId, { plan: 'Hacked' })).toBeNull();
    const { soapNote } = await soapNotes.findSoapNote(consultationId, doctorId);
    expect(soapNote).toMatchObject({ soapNoteId: created.soapNoteId, plan: 'P' });
    expect(soapNote).not.toHaveProperty('aiResult');

    const updatedAt = await soapNotes.update(consultationId, doctorId, { plan: 'Panadol – کھانے کے بعد' });

    expect(updatedAt > created.updatedAt).toBe(true);
    expect(await prisma.soapNote.findUnique({ where: { consultationId } })).toMatchObject({
      subjective: 'S',
      plan: 'Panadol – کھانے کے بعد',
      aiResult: { a: 1 },
      updatedAt,
    });
  });

  it('lists a patient’s consultations newest first with the assessment, paged', async () => {
    const patient = await patients.insert(doctorId, newPatient('03000000014'));
    const ids = [];
    for (const day of [7, 9, 8]) {
      const c = await consultations.create({
        clinicalPatientId: patient.clinicalPatientId,
        status: 'completed',
        startedAt: new Date(Date.UTC(2026, 9, day, 9)),
      });
      await prisma.soapNote.create({ data: { consultationId: c.consultationId, assessment: `Day ${day}` } });
      ids.push(c.consultationId);
    }

    const first = await soapNotes.findByPatient(doctorId, patient.clinicalPatientId, { page: 1, pageSize: 2 });
    const second = await soapNotes.findByPatient(doctorId, patient.clinicalPatientId, { page: 2, pageSize: 2 });

    expect(first.total).toBe(3);
    expect(first.rows.map((r) => r.soapNote.assessment)).toEqual(['Day 9', 'Day 8']);
    expect(second.rows.map((r) => r.consultationId)).toEqual([ids[0]]);
    expect(await soapNotes.findByPatient(otherDoctorId, patient.clinicalPatientId, { page: 1, pageSize: 20 })).toEqual({
      rows: [],
      total: 0,
    });
  });

  it('searches notes by part of the name or phone, only the doctor’s own, with % and _ as plain text', async () => {
    const mine = await patients.insert(doctorId, { ...newPatient('03219990001'), fullName: 'Zarqa_Search 100%' });
    const theirs = await patients.insert(otherDoctorId, { ...newPatient('03219990001'), fullName: 'Zarqa_Search 100%' });
    const noNote = await patients.insert(doctorId, { ...newPatient('03219990002'), fullName: 'Zarqa Without Note' });
    for (const p of [mine, theirs, noNote]) {
      const c = await consultations.create({ clinicalPatientId: p.clinicalPatientId, status: 'completed', startedAt: new Date() });
      if (p !== noNote) await prisma.soapNote.create({ data: { consultationId: c.consultationId } });
    }
    const page = { page: 1, pageSize: 20 };

    const byName = await soapNotes.search(doctorId, 'zarqa_s', page);
    expect(byName.total).toBe(1);
    expect(byName.rows).toEqual([
      expect.objectContaining({ clinicalPatientId: mine.clinicalPatientId, fullName: 'Zarqa_Search 100%', phone: '03219990001' }),
    ]);
    expect((await soapNotes.search(doctorId, '99900', page)).total).toBe(1);
    expect((await soapNotes.search(doctorId, '100%', page)).total).toBe(1);
    // "_" and "%" match only themselves, not any character.
    expect((await soapNotes.search(doctorId, 'zarqa%note', page)).total).toBe(0);
    expect((await soapNotes.search(doctorId, 'zarq__', page)).total).toBe(0);
  });

  it('lists the doctor’s latest notes without q, newest first', async () => {
    const patient = await patients.insert(doctorId, newPatient('03219990003'));
    const c = await consultations.create({ clinicalPatientId: patient.clinicalPatientId, status: 'completed', startedAt: new Date(Date.UTC(2030, 0, 1)) });
    await prisma.soapNote.create({ data: { consultationId: c.consultationId } });

    const latest = await soapNotes.search(doctorId, undefined, { page: 1, pageSize: 1 });
    expect(latest.rows).toEqual([expect.objectContaining({ consultationId: c.consultationId, phone: '03219990003' })]);
    expect(latest.total).toBeGreaterThan(1);
    expect((await soapNotes.search(otherDoctorId, undefined, { page: 1, pageSize: 50 })).rows.map((r) => r.consultationId)).not.toContain(c.consultationId);
  });

  it('lists the doctor’s patients newest first, filtered by part of the name or phone', async () => {
    const first = await patients.insert(doctorId, { ...newPatient('03219990004'), fullName: 'Qudsia List_Test' });
    const second = await patients.insert(doctorId, { ...newPatient('03219990005'), fullName: 'Qudsia Other' });
    await patients.insert(otherDoctorId, { ...newPatient('03219990004'), fullName: 'Qudsia List_Test' });
    const page = { page: 1, pageSize: 20 };

    const byName = await patients.list(doctorId, 'qudsia', page);
    expect(byName.total).toBe(2);
    expect(byName.rows.map((r) => r.clinicalPatientId)).toEqual([second.clinicalPatientId, first.clinicalPatientId]);
    expect(byName.rows[1]).toEqual({
      clinicalPatientId: first.clinicalPatientId,
      fullName: 'Qudsia List_Test',
      phone: '03219990004',
      email: null,
      age: 45,
      gender: 'male',
      createdAt: expect.any(Date),
    });
    expect((await patients.list(doctorId, '9990005', page)).total).toBe(1);
    expect((await patients.list(doctorId, 'list_t', page)).total).toBe(1);
    expect((await patients.list(doctorId, 'list%', page)).total).toBe(0);
    expect((await patients.list(doctorId, undefined, page)).total).toBeGreaterThanOrEqual(2);
  });

  it('finds all transcript windows in order', async () => {
    const { consultationId } = await newConsultation('processing');
    await transcripts.createPendingWindow(consultationId, 2);
    await transcripts.createPendingWindow(consultationId, 1);

    expect((await transcripts.findWindows(consultationId)).map((w) => w.windowNo)).toEqual([1, 2]);
  });
});
