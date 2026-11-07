// Reads and saves TRANSCRIPT_WINDOW rows.
export class TranscriptRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // INSERT ... ON CONFLICT DO NOTHING on (consultation_id, window_no).
  // Returns true only when this call created the row, so each minute is sent once.
  async createPendingWindow(consultationId, windowNo) {
    const { count } = await this.prisma.transcriptWindow.createMany({
      data: [{ consultationId, windowNo, status: 'pending' }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  findWindow(consultationId, windowNo) {
    return this.prisma.transcriptWindow.findUnique({
      where: { consultationId_windowNo: { consultationId, windowNo } },
    });
  }

  // All windows of the consultation, in window_no order.
  findWindows(consultationId) {
    return this.prisma.transcriptWindow.findMany({ where: { consultationId }, orderBy: { windowNo: 'asc' } });
  }

  saveText(consultationId, windowNo, transcriptText) {
    return this.prisma.transcriptWindow.updateMany({
      where: { consultationId, windowNo },
      data: { transcriptText, status: 'done' },
    });
  }

  updateStatus(consultationId, windowNo, status) {
    return this.prisma.transcriptWindow.updateMany({ where: { consultationId, windowNo }, data: { status } });
  }

  deleteWindow(consultationId, windowNo) {
    return this.prisma.transcriptWindow.deleteMany({ where: { consultationId, windowNo } });
  }
}
