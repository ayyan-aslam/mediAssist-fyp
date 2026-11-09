import { Prisma } from '../../generated/prisma/client.ts';

// Saves, updates, deletes and finds FOLLOW_UP_REMINDER rows, and keeps the last change of each consultation
// in FOLLOW_UP_CHANGE (design doc Diagram 10). The TIMESTAMP columns hold UTC times.
export class ReminderRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // fn(repository) runs in one transaction, with a repository that uses it.
  async transaction(fn) {
    return this.prisma.$transaction((tx) => fn(new ReminderRepository(tx)));
  }

  // Saves the change only when it is newer than the saved one. Returns false for an older (or the same)
  // changedAt. The row stays locked until the transaction ends, so two changes of one consultation wait
  // for each other.
  async saveChangeIfNewer({ consultationId, followUpDate, doctorName, patientName, changedAt }) {
    const rows = await this.prisma.$queryRaw`
      INSERT INTO follow_up_change (consultation_id, follow_up_date, doctor_name, patient_name, changed_at)
      VALUES (${consultationId}, ${followUpDate}::date, ${doctorName}, ${patientName},
              ${changedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      ON CONFLICT (consultation_id) DO UPDATE
        SET follow_up_date = EXCLUDED.follow_up_date,
            doctor_name = EXCLUDED.doctor_name,
            patient_name = EXCLUDED.patient_name,
            changed_at = EXCLUDED.changed_at
        WHERE follow_up_change.changed_at < EXCLUDED.changed_at
      RETURNING consultation_id`;
    return rows.length === 1;
  }

  // Updates the pending reminder of this recipient, or adds one when there is none.
  async upsertPending(consultationId, recipientType, recipientEmail, scheduledAt) {
    const { count } = await this.prisma.followUpReminder.updateMany({
      where: { consultationId, recipientType, status: 'pending' },
      data: { recipientEmail, scheduledAt },
    });
    if (count === 0) {
      await this.prisma.followUpReminder.create({
        data: { consultationId, recipientType, recipientEmail, scheduledAt, status: 'pending' },
      });
    }
  }

  // recipientType: 'patient' or 'doctor', or leave it out for both. Sent and failed rows stay.
  async deletePending(consultationId, recipientType) {
    await this.prisma.followUpReminder.deleteMany({
      where: { consultationId, status: 'pending', ...(recipientType && { recipientType }) },
    });
  }

  // Claims up to `limit` pending reminders whose time has come (all pending ones with all: true) in one
  // UPDATE ... RETURNING. A claimed row is marked sent at once, so another instance never claims it again;
  // FOR UPDATE SKIP LOCKED lets two instances claim different rows at the same time. Returns each reminder
  // with the follow-up date and the names for the email.
  async claimDue({ all = false, limit }) {
    const due = all ? Prisma.empty : Prisma.sql`AND scheduled_at <= (NOW() AT TIME ZONE 'UTC')`;
    return this.prisma.$queryRaw`
      UPDATE follow_up_reminder r
      SET status = 'sent', sent_at = NOW() AT TIME ZONE 'UTC'
      FROM follow_up_change c
      WHERE c.consultation_id = r.consultation_id
        AND r.status = 'pending'
        AND r.reminder_id IN (
          SELECT reminder_id FROM follow_up_reminder
          WHERE status = 'pending' ${due}
          ORDER BY scheduled_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING r.reminder_id AS "reminderId", r.consultation_id AS "consultationId",
                r.recipient_type AS "recipientType", r.recipient_email AS "recipientEmail",
                c.follow_up_date::text AS "followUpDate", c.doctor_name AS "doctorName",
                c.patient_name AS "patientName"`;
  }

  async markSent(reminderId, sentAt) {
    await this.prisma.followUpReminder.update({ where: { reminderId }, data: { status: 'sent', sentAt } });
  }

  async markFailed(reminderId) {
    await this.prisma.followUpReminder.update({ where: { reminderId }, data: { status: 'failed', sentAt: null } });
  }
}
