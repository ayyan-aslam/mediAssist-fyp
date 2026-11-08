import { createLogger } from '@mediassist/common';
import request from 'supertest';
import { vi } from 'vitest';
import { createApp } from '../src/app.js';
import { EditSessionStore } from '../src/services/EditSessionStore.js';
import { SseManager } from '../src/services/SseManager.js';

export const DOCTOR_ID = 16;
export const OTHER_DOCTOR_ID = 17;
export const DOCTOR_IP = '39.45.12.8';
export const DOCTOR_NAME = 'Dr. Sara Ahmed';
export const DOCTOR_EMAIL = 'sara@example.com';

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
  const audioParts = [];
  const windows = [];
  const soapNotes = [];

  const matches = (patient, q) => patient.fullName.toLowerCase().includes(q.toLowerCase()) || patient.phone.includes(q);
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
    // Like ILIKE '%q%' on the name or phone, newest first.
    async list(doctorId, q, { page, pageSize }) {
      const rows = patients
        .filter((p) => p.doctorId === doctorId && (!q || matches(p, q)))
        .sort((a, b) => b.createdAt - a.createdAt || b.clinicalPatientId - a.clinicalPatientId);
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
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
    async updateFollowUp(id, doctorId, followUpDate) {
      const row = consultations.find((c) => c.consultationId === id);
      const patient = row && patientOf(row);
      if (!row || patient.doctorId !== doctorId) return null;
      row.followUpDate = followUpDate;
      return { fullName: patient.fullName, email: patient.email };
    },
    async findPatientContact(id) {
      const row = consultations.find((c) => c.consultationId === id);
      if (!row) return null;
      const { fullName, age, gender, phone, email } = patientOf(row);
      return { clinicalPatient: { fullName, age, gender, phone, email } };
    },
    async findPart(consultationId, partNo) {
      return audioParts.find((p) => p.consultationId === consultationId && p.partNo === partNo) ?? null;
    },
    async savePart(part) {
      if (await this.findPart(part.consultationId, part.partNo)) throw uniqueViolation();
      const row = { audioPartId: audioParts.length + 1, ...part, recordedAt: new Date() };
      audioParts.push(row);
      return row;
    },
    async countPartsInRange(consultationId, first, last) {
      return audioParts.filter((p) => p.consultationId === consultationId && p.partNo >= first && p.partNo <= last)
        .length;
    },
    async findSavedPartNos(consultationId) {
      return audioParts
        .filter((p) => p.consultationId === consultationId)
        .map((p) => p.partNo)
        .sort((a, b) => a - b);
    },
    async countParts(consultationId) {
      return audioParts.filter((p) => p.consultationId === consultationId).length;
    },
    // Like DELETE ... WHERE status IN (...) with ON DELETE CASCADE: the parts and minutes go too.
    async deleteDiscardable(id, statuses) {
      const index = consultations.findIndex((c) => c.consultationId === id && statuses.includes(c.status));
      if (index < 0) return null;
      consultations.splice(index, 1);
      const keys = audioParts.filter((p) => p.consultationId === id).map((p) => p.fileKey);
      for (const list of [audioParts, windows]) {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].consultationId === id) list.splice(i, 1);
      }
      return keys;
    },
    // Updates WHERE status = from, like updateMany. Returns true when a row changed.
    async markProcessing(id, endedAt) {
      return changeIf(id, 'recording', { status: 'processing', endedAt });
    },
    async backToRecording(id) {
      changeIf(id, 'processing', { status: 'recording', endedAt: null });
    },
    async startRetry(id) {
      const row = consultations.find((c) => c.consultationId === id);
      return changeIf(id, 'failed', {
        soapAttempt: (row?.soapAttempt ?? 0) + 1,
        status: 'processing',
        failureReason: null,
        aiRequestedAt: null,
      });
    },
    async backToFailed(id, failureReason) {
      changeIf(id, 'processing', { status: 'failed', failureReason });
    },
  };

  function changeIf(id, status, changes) {
    const row = consultations.find((c) => c.consultationId === id && c.status === status);
    if (!row) return false;
    Object.assign(row, changes);
    return true;
  }

  // Like INSERT ... ON CONFLICT DO NOTHING: true only for the call that created the row.
  const transcriptRepository = {
    async createPendingWindow(consultationId, windowNo) {
      if (windows.some((w) => w.consultationId === consultationId && w.windowNo === windowNo)) return false;
      windows.push({ consultationId, windowNo, status: 'pending' });
      return true;
    },
    async deleteWindow(consultationId, windowNo) {
      const index = windows.findIndex((w) => w.consultationId === consultationId && w.windowNo === windowNo);
      if (index >= 0) windows.splice(index, 1);
    },
  };

  // The consultation, only when it belongs to this doctor.
  const consultationOf = (doctorId, id) =>
    consultations.find((c) => c.consultationId === id && patientOf(c).doctorId === doctorId);
  const noteOf = (consultationId) => soapNotes.find((n) => n.consultationId === consultationId) ?? null;
  const newestFirst = (a, b) => b.startedAt - a.startedAt || b.consultationId - a.consultationId;
  const pageOf = (rows, { page, pageSize }) => rows.slice((page - 1) * pageSize, page * pageSize);

  const soapNoteRepository = {
    async findSoapNote(consultationId, doctorId, { withAiResult = false } = {}) {
      if (!consultationOf(doctorId, consultationId)) return null;
      const note = noteOf(consultationId);
      if (!note) return { soapNote: null };
      const { aiResult, ...rest } = note;
      return { soapNote: withAiResult ? { ...rest, aiResult: aiResult ?? null } : rest };
    },
    async findForPdf(consultationId, doctorId) {
      const consultation = consultationOf(doctorId, consultationId);
      if (!consultation) return null;
      const { fullName, age, gender, phone } = patientOf(consultation);
      return {
        startedAt: consultation.startedAt,
        clinicalPatient: { fullName, age, gender, phone },
        soapNote: noteOf(consultationId),
      };
    },
    async findPrescriptionSource(consultationId, doctorId) {
      const consultation = consultationOf(doctorId, consultationId);
      if (!consultation) return null;
      const { fullName, age, gender, phone, email } = patientOf(consultation);
      const note = noteOf(consultationId);
      return {
        clinicalPatient: { fullName, age, gender, phone, email },
        soapNote: note && { plan: note.plan, aiResult: note.aiResult ?? null, prescription: note.prescription ?? null },
      };
    },
    async update(consultationId, doctorId, changes) {
      const note = consultationOf(doctorId, consultationId) && noteOf(consultationId);
      if (!note) return null;
      Object.assign(note, changes, { updatedAt: new Date() });
      return note.updatedAt;
    },
    async findByPatient(doctorId, clinicalPatientId, paging) {
      const rows = consultations
        .filter((c) => c.clinicalPatientId === clinicalPatientId && patientOf(c).doctorId === doctorId)
        .sort(newestFirst)
        .map((c) => ({ ...c, soapNote: noteOf(c.consultationId) }));
      return { rows: pageOf(rows, paging), total: rows.length };
    },
    // Like ILIKE '%q%' on the name or phone. Without q, all the doctor's notes.
    async search(doctorId, q, paging) {
      const rows = consultations
        .filter((c) => noteOf(c.consultationId))
        .map((c) => ({ ...c, ...patientOf(c) }))
        .filter((r) => r.doctorId === doctorId && (!q || matches(r, q)))
        .sort(newestFirst);
      return { rows: pageOf(rows, paging), total: rows.length };
    },
  };

  // A SOAP note as the AI Pipeline answer saves it (status completed).
  function addSoapNote(consultationId, parts = {}) {
    const consultation = consultations.find((c) => c.consultationId === consultationId);
    consultation.status = 'completed';
    const now = new Date();
    const note = {
      soapNoteId: soapNotes.length + 1,
      consultationId,
      subjective: 'Sore throat for 3 days.',
      objective: 'Temperature 100 F.',
      assessment: 'Viral throat infection.',
      plan: 'Panadol 500 mg twice a day.',
      createdAt: now,
      updatedAt: now,
      ...parts,
    };
    soapNotes.push(note);
    return note;
  }

  return {
    patients,
    consultations,
    audioParts,
    windows,
    soapNotes,
    addSoapNote,
    patientRepository,
    consultationRepository,
    transcriptRepository,
    soapNoteRepository,
  };
}

export function createTestContext() {
  const fakes = createFakeRepositories();
  const s3Client = { upload: vi.fn(async (key) => key), deleteMany: vi.fn(async () => {}) };
  const eventPublisher = { publish: vi.fn(async (type, data) => ({ type, data })) };
  const logger = createLogger('test', 'silent');
  const sseManager = new SseManager({ logger });
  const editSessionStore = new EditSessionStore();
  const app = createApp({
    logger,
    patientRepository: fakes.patientRepository,
    consultationRepository: fakes.consultationRepository,
    transcriptRepository: fakes.transcriptRepository,
    soapNoteRepository: fakes.soapNoteRepository,
    s3Client,
    eventPublisher,
    sseManager,
    editSessionStore,
  });

  // A request with the headers the API Gateway adds after it checks the token and the role.
  const as = (doctorId = DOCTOR_ID, role = 'doctor') => {
    const send = (req) =>
      req
        .set('x-user-id', String(doctorId))
        .set('x-user-role', role)
        .set('x-user-ip', DOCTOR_IP)
        .set('x-user-name', encodeURIComponent(DOCTOR_NAME))
        .set('x-user-email', DOCTOR_EMAIL);
    return {
      get: (url) => send(request(app).get(url)),
      post: (url) => send(request(app).post(url)),
      patch: (url) => send(request(app).patch(url)),
      put: (url) => send(request(app).put(url)),
      delete: (url) => send(request(app).delete(url)),
    };
  };

  return { app, as, s3Client, eventPublisher, sseManager, editSessionStore, logger, ...fakes };
}
