// Reads and saves PRESCRIPTION_DELIVERY (design doc Diagram 9).
export class DeliveryRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findByMessageId(messageId) {
    return this.prisma.prescriptionDelivery.findUnique({ where: { messageId } });
  }

  // The final result of one send request. Throws a P2002 error when the messageId is already saved.
  async create({ messageId, prescriptionId, channel, recipient, status, errorMessage, attemptedAt }) {
    return this.prisma.prescriptionDelivery.create({
      data: { messageId, prescriptionId, channel, recipient, status, errorMessage, attemptedAt },
    });
  }
}
