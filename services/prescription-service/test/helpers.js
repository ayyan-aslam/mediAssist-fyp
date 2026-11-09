import { Readable } from 'node:stream';
import { AppError, createLogger } from '@mediassist/common';
import request from 'supertest';
import { vi } from 'vitest';
import { createApp } from '../src/app.js';
import { pdfKeyOf } from '../src/repositories/PrescriptionRepository.js';
import { PrescriptionPdf } from '../src/services/PrescriptionPdf.js';
import { PrescriptionService } from '../src/services/PrescriptionService.js';

export const DOCTOR_ID = 16;
export const OTHER_DOCTOR_ID = 17;
export const DOCTOR_IP = '39.45.12.8';
export const DOCTOR_NAME = 'Dr. Sara Ahmed';
export const CONSULTATION_ID = 41;

// What GET /internal/consultations/41/prescription-source returns (design doc 5.5).
export function prescriptionSource(changes = {}) {
  return {
    consultationId: CONSULTATION_ID,
    doctorId: DOCTOR_ID,
    patient: { name: 'Ali Raza', age: 34, gender: 'male', phone: '03001234567', email: 'ali@example.com' },
    notes: 'Warm salt water gargles.',
    medicines: [
      {
        name: 'Panadol',
        genericName: 'Paracetamol',
        dose: '1 tablet',
        frequency: 'twice a day',
        duration: '3 days',
        instructions: null,
        source: 'doctor_prescribed',
        referenceInfo: { indication: 'Fever and pain' },
      },
      {
        name: 'Act-On',
        genericName: 'Domperidone',
        dose: '1 tablet',
        frequency: 'three times a day',
        duration: '2 days',
        instructions: 'Before meals',
        source: 'ai_accepted',
        referenceInfo: { indication: 'Vomiting' },
      },
      {
        name: 'ORS',
        genericName: null,
        dose: '1 sachet',
        frequency: null,
        duration: null,
        instructions: 'In 1 litre of water',
        source: 'doctor_added',
        referenceInfo: null,
      },
    ],
    ...changes,
  };
}

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

// An in-memory copy of the PrescriptionRepository, so the tests do not need a database.
// It keeps the same doctor rules and unique keys as the Prisma queries.
function createFakeRepository() {
  const prescriptions = [];
  const sends = [];
  let nextItemId = 1;

  const withItems = (row) => row && { ...row, items: [...row.items].sort((a, b) => a.position - b.position) };

  const prescriptionRepository = {
    async findByConsultation(consultationId, doctorId) {
      return withItems(prescriptions.find((p) => p.consultationId === consultationId && p.doctorId === doctorId)) ?? null;
    },
    async findById(prescriptionId, doctorId) {
      return withItems(prescriptions.find((p) => p.prescriptionId === prescriptionId && p.doctorId === doctorId)) ?? null;
    },
    async create({ consultationId, doctorId, patientName, notes, items }) {
      if (prescriptions.some((p) => p.consultationId === consultationId)) throw uniqueViolation();
      const prescriptionId = prescriptions.length + 1;
      const row = {
        prescriptionId,
        consultationId,
        doctorId,
        status: 'final',
        patientName,
        notes,
        pdfKey: pdfKeyOf(prescriptionId),
        createdAt: new Date(),
        items: items.map((item) => ({ itemId: nextItemId++, prescriptionId, ...item })),
      };
      prescriptions.push(row);
      return withItems(row);
    },
    async delete(prescriptionId) {
      prescriptions.splice(prescriptions.findIndex((p) => p.prescriptionId === prescriptionId), 1);
    },
    async createSend(data) {
      if (sends.some((s) => s.messageId === data.messageId)) throw uniqueViolation();
      const row = { sendId: sends.length + 1, ...data, status: 'sending', errorMessage: null, completedAt: null };
      sends.push(row);
      return { ...row };
    },
    async completeSend({ prescriptionId, messageId, status, errorMessage, completedAt }) {
      const row = sends.find(
        (s) => s.prescriptionId === prescriptionId && s.messageId === messageId && s.status === 'sending',
      );
      if (!row) return false;
      Object.assign(row, { status, errorMessage, completedAt });
      return true;
    },
    async listSends(prescriptionId, { page, pageSize }) {
      const rows = sends
        .filter((s) => s.prescriptionId === prescriptionId)
        .sort((a, b) => b.requestedAt - a.requestedAt || b.sendId - a.sendId);
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
    },
  };

  return { prescriptions, sends, prescriptionRepository };
}

// A fake Consultation Service client. sources: consultationId -> prescription-source answer.
// Like the real endpoint, another doctor's consultation is not found.
function createFakeConsultationClient() {
  const sources = new Map([[CONSULTATION_ID, prescriptionSource()]]);
  const notFound = () => new AppError(404, 'CONSULTATION_NOT_FOUND', 'This consultation was not found.');
  return {
    sources,
    getPrescriptionSource: vi.fn(async (consultationId, doctorId) => {
      const source = sources.get(consultationId);
      if (!source || source.doctorId !== doctorId) throw notFound();
      if (source.soapNotReady) throw new AppError(409, 'SOAP_NOT_READY', 'The SOAP note is not ready yet.');
      return source;
    }),
    getPatientContact: vi.fn(async (consultationId) => {
      const source = sources.get(consultationId);
      if (!source) throw notFound();
      const { name, ...contact } = source.patient;
      return { fullName: name, ...contact };
    }),
  };
}

export function createTestContext() {
  const fakes = createFakeRepository();
  const consultationClient = createFakeConsultationClient();
  // The S3 bucket: key -> file.
  const files = new Map();
  const s3Client = {
    files,
    upload: vi.fn(async (key, body) => {
      files.set(key, body);
      return key;
    }),
    getStream: vi.fn(async (key) => {
      if (!files.has(key)) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
      return Readable.from([files.get(key)]);
    }),
  };
  const eventPublisher = {
    publish: vi.fn(async (type, data, { messageId = crypto.randomUUID() } = {}) => ({ messageId, type, data })),
  };
  const logger = createLogger('test', 'silent');
  const prescriptionService = new PrescriptionService({
    prescriptionRepository: fakes.prescriptionRepository,
    consultationClient,
    prescriptionPdf: new PrescriptionPdf(),
    s3Client,
    eventPublisher,
    logger,
  });
  const app = createApp({ logger, prescriptionService });

  // A request with the headers the API Gateway adds after it checks the token and the role.
  const as = (doctorId = DOCTOR_ID, role = 'doctor') => {
    const send = (req) =>
      req
        .set('x-user-id', String(doctorId))
        .set('x-user-role', role)
        .set('x-user-ip', DOCTOR_IP)
        .set('x-user-name', encodeURIComponent(DOCTOR_NAME));
    return {
      get: (url) => send(request(app).get(url)),
      post: (url) => send(request(app).post(url)),
    };
  };

  const finalize = (doctorId = DOCTOR_ID, consultationId = CONSULTATION_ID) =>
    as(doctorId).post('/prescriptions').send({ consultationId });

  return { app, as, finalize, s3Client, eventPublisher, consultationClient, prescriptionService, logger, ...fakes };
}

// Reads a binary answer (the PDF) as a Buffer.
export const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};
