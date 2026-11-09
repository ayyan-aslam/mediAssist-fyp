// Saves each audit event, and lists the logs for the admin with each user's name and role
// (design doc 3.4.9 and Diagram 12).
export class AuditService {
  // timeZone: the from and to dates of the list are whole days there.
  constructor({ auditRepository, userClient, timeZone, logger }) {
    this.auditRepository = auditRepository;
    this.userClient = userClient;
    this.timeZone = timeZone;
    this.logger = logger;
  }

  // event: the checked audit.event. Safe to run twice: a messageId that is already saved is skipped.
  async record(event) {
    const added = await this.auditRepository.insert(event);
    const log = { messageId: event.messageId, userId: event.userId, action: event.action };
    this.logger.info(log, added ? 'Audit event saved' : 'Audit event already saved, skipped');
  }

  // GET /admin/audit-logs (design doc 5.10), newest first.
  async list({ from, to, userId, action, page, pageSize }) {
    const { rows, total } = await this.auditRepository.find({
      from: from && startOfDay(from, this.timeZone),
      before: to && startOfDay(nextDay(to), this.timeZone),
      userId,
      action,
      page,
      pageSize,
    });

    const userIds = [...new Set(rows.map((row) => row.userId))];
    const users = userIds.length ? await this.userClient.getUsers(userIds) : [];
    const byId = new Map(users.map((user) => [user.userId, user]));

    return {
      items: rows.map((row) => ({
        logId: Number(row.logId),
        user: toUser(byId.get(row.userId), row.userId),
        action: row.action,
        details: row.details,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}

// A user the Auth & User Service does not know keeps the ID, with no name or role.
function toUser(user, userId) {
  return { userId, fullName: user?.fullName ?? null, role: user?.role ?? null };
}

function nextDay(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// The moment when this day starts in timeZone.
function startOfDay(date, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const asUtc = Date.UTC(year, month - 1, day);
  return new Date(asUtc - offsetMs(asUtc, timeZone));
}

// How far the clock in timeZone is ahead of UTC at this moment.
function offsetMs(time, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(time)
      .map(({ type, value }) => [type, Number(value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - time;
}
