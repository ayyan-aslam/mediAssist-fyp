// Inserts and reads AUDIT_LOG rows (design doc Diagram 12). Its database login (audit_service) can only
// INSERT and SELECT, so nobody can edit or delete a log. The TIMESTAMP column holds UTC times.
export class AuditRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // Returns true when the row was added, false when this messageId is already saved.
  async insert({ messageId, userId, action, details, ipAddress, occurredAt }) {
    const count = await this.prisma.$executeRaw`
      INSERT INTO audit_log (message_id, user_id, action, details, ip_address, created_at)
      VALUES (${messageId}::uuid, ${userId}, ${action}, ${details}, ${ipAddress},
              ${occurredAt}::timestamptz AT TIME ZONE 'UTC')
      ON CONFLICT (message_id) DO NOTHING`;
    return count === 1;
  }

  // Newest first. from: the first moment to include. before: the first moment not to include.
  async find({ from, before, userId, action, page, pageSize }) {
    const where = {
      ...((from || before) && { createdAt: { ...(from && { gte: from }), ...(before && { lt: before }) } }),
      ...(userId && { userId }),
      ...(action && { action }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { logId: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { rows, total };
  }
}
