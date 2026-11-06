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

  deleteWindow(consultationId, windowNo) {
    return this.prisma.transcriptWindow.deleteMany({ where: { consultationId, windowNo } });
  }
}
