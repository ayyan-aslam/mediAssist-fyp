import { Prisma } from '../../generated/prisma/client.ts';

// Key of the PDF in Amazon S3 (design doc 4.4.5).
export const pdfKeyOf = (prescriptionId) => `prescriptions/${prescriptionId}.pdf`;

const WITH_ITEMS = { items: { orderBy: { position: 'asc' } } };

// Long enough to build the PDF and upload it to S3 inside the finalize transaction.
const FINALIZE_TIMEOUT_MS = 30_000;

// Reads and saves PRESCRIPTION, PRESCRIPTION_ITEM and PRESCRIPTION_SEND (design doc Diagrams 8 and 9).
// Every read takes the doctor, so a doctor never sees another doctor's prescription.
export class PrescriptionRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findByConsultation(consultationId, doctorId) {
    return this.prisma.prescription.findFirst({ where: { consultationId, doctorId }, include: WITH_ITEMS });
  }

  async findById(prescriptionId, doctorId) {
    return this.prisma.prescription.findFirst({ where: { prescriptionId, doctorId }, include: WITH_ITEMS });
  }

  // The prescription and its lines in one transaction, with its PDF key. The key needs the new ID, so the
  // row is saved first and the key set right after, before anyone else can read it.
  // savePdf(prescription) runs before the commit: when it fails (or the process stops), nothing is saved,
  // so a prescription never exists without its PDF.
  // Throws a P2002 error when the consultation already has a prescription.
  async create({ consultationId, doctorId, patientName, notes, items }, savePdf) {
    return this.prisma.$transaction(
      async (tx) => {
        const { prescriptionId } = await tx.prescription.create({
          data: {
            consultationId,
            doctorId,
            status: 'final',
            patientName,
            notes,
            pdfKey: '',
            items: {
              create: items.map((item) => ({ ...item, referenceInfo: item.referenceInfo ?? Prisma.DbNull })),
            },
          },
          select: { prescriptionId: true },
        });
        const prescription = await tx.prescription.update({
          where: { prescriptionId },
          data: { pdfKey: pdfKeyOf(prescriptionId) },
          include: WITH_ITEMS,
        });
        await savePdf(prescription);
        return prescription;
      },
      { timeout: FINALIZE_TIMEOUT_MS },
    );
  }

  async createSend({ prescriptionId, messageId, channel, recipient, requestedAt }) {
    return this.prisma.prescriptionSend.create({
      data: { prescriptionId, messageId, channel, recipient, status: 'sending', requestedAt },
    });
  }

  // sending -> sent or failed. Only a send that is still sending changes, so a message handled twice
  // changes nothing. Returns true when the row changed.
  async completeSend({ prescriptionId, messageId, status, errorMessage, completedAt }) {
    const { count } = await this.prisma.prescriptionSend.updateMany({
      where: { prescriptionId, messageId, status: 'sending' },
      data: { status, errorMessage, completedAt },
    });
    return count === 1;
  }

  // Newest first.
  async listSends(prescriptionId, { page, pageSize }) {
    const where = { prescriptionId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.prescriptionSend.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { sendId: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.prescriptionSend.count({ where }),
    ]);
    return { rows, total };
  }
}
