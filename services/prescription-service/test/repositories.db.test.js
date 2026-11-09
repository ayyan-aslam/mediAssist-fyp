// Checks the Prisma queries, the check rules and the unique keys against the real PrescriptionDB (Docker).
// Skipped when PRESCRIPTION_DATABASE_URL is not set. Run the migrations first (npm run db:migrate).
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/prisma.js';
import { PrescriptionRepository } from '../src/repositories/PrescriptionRepository.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: use the variables that are already set.
}

const databaseUrl = process.env.PRESCRIPTION_DATABASE_URL;
// A doctor ID and consultation IDs that no real record has, so the rows made here can be removed afterwards.
const doctorId = -crypto.randomInt(1e6, 1e9);
let nextConsultationId = doctorId;

const newPrescription = (items = [{ position: 1, medicineName: 'Panadol', source: 'doctor_prescribed', referenceInfo: { indication: 'Fever' } }]) => ({
  consultationId: nextConsultationId--,
  doctorId,
  patientName: 'بلال حسین',
  notes: 'Warm salt water gargles.',
  items,
});

// The PDF upload, done before the commit.
const savePdf = async () => {};

describe.skipIf(!databaseUrl)('PrescriptionRepository (database)', () => {
  let prisma;
  let repository;

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl);
    repository = new PrescriptionRepository(prisma);
  });

  afterAll(async () => {
    const where = { prescription: { doctorId } };
    await prisma.prescriptionSend.deleteMany({ where });
    await prisma.prescription.deleteMany({ where: { doctorId } });
    await prisma.$disconnect();
  });

  it('saves the prescription, its lines and the PDF key; one prescription per consultation', async () => {
    const data = newPrescription([
      { position: 2, medicineName: 'ORS', source: 'doctor_added', referenceInfo: null },
      { position: 1, medicineName: 'Panadol', source: 'ai_accepted', referenceInfo: { indication: 'Fever' } },
    ]);
    const saved = await repository.create(data, savePdf);

    expect(saved.pdfKey).toBe(`prescriptions/${saved.prescriptionId}.pdf`);
    expect(saved.patientName).toBe('بلال حسین');
    expect(saved.items.map((item) => item.medicineName)).toEqual(['Panadol', 'ORS']);
    expect(saved.items[1].referenceInfo).toBeNull();
    expect(await repository.findById(saved.prescriptionId, doctorId - 1)).toBeNull();

    await expect(repository.create({ ...data, items: [] }, savePdf)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a line source outside the allowed values and rolls the whole prescription back', async () => {
    const data = newPrescription([{ position: 1, medicineName: 'Panadol', source: 'ai_suggested' }]);
    await expect(repository.create(data, savePdf)).rejects.toThrow();
    expect(await repository.findByConsultation(data.consultationId, doctorId)).toBeNull();
  });

  it('saves nothing when the PDF cannot be saved', async () => {
    const data = newPrescription();
    await expect(
      repository.create(data, async () => {
        throw new Error('S3 is down');
      }),
    ).rejects.toThrow('S3 is down');
    expect(await repository.findByConsultation(data.consultationId, doctorId)).toBeNull();
  });

  it('completes a send once, and lists the sends newest first', async () => {
    const { prescriptionId } = await repository.create(newPrescription(), savePdf);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await repository.createSend({ prescriptionId, messageId: first, channel: 'email', recipient: 'ali@example.com', requestedAt: new Date('2026-10-07T09:40:00Z') });
    await repository.createSend({ prescriptionId, messageId: second, channel: 'email', recipient: 'ali@example.com', requestedAt: new Date('2026-10-07T09:41:00Z') });

    const done = { prescriptionId, messageId: first, status: 'sent', errorMessage: null, completedAt: new Date() };
    expect(await repository.completeSend(done)).toBe(true);
    expect(await repository.completeSend({ ...done, status: 'failed' })).toBe(false);

    const { rows, total } = await repository.listSends(prescriptionId, { page: 1, pageSize: 20 });
    expect(total).toBe(2);
    expect(rows.map((row) => [row.messageId, row.status])).toEqual([
      [second, 'sending'],
      [first, 'sent'],
    ]);

    await expect(
      repository.createSend({ prescriptionId, messageId: first, channel: 'email', recipient: 'x@example.com', requestedAt: new Date() }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      repository.createSend({ prescriptionId, messageId: crypto.randomUUID(), channel: 'whatsapp', recipient: '0300', requestedAt: new Date() }),
    ).rejects.toThrow();
  });
});
