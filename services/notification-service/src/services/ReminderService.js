// Creates, updates or deletes the pending follow-up reminders (design doc Diagram 10, Part 2, and 6.4.9).
// The doctor always gets one. The patient gets one only when the patient has an email.
export class ReminderService {
  // timeZone and hour: the reminder goes out at this hour, there, one day before the follow-up date.
  constructor({ reminderRepository, timeZone, hour, logger, now = () => new Date() }) {
    this.reminderRepository = reminderRepository;
    this.timeZone = timeZone;
    this.hour = hour;
    this.logger = logger;
    this.now = now;
  }

  // data: the checked followup.changed data. Safe to run twice: rows are updated, never added twice, and
  // a message that is not newer than the last change of the consultation is ignored.
  async handleFollowUpChanged(data) {
    const { consultationId, followUpDate, doctorEmail, patientEmail } = data;
    const changedAt = new Date(data.changedAt);

    const applied = await this.reminderRepository.transaction(async (repository) => {
      const newer = await repository.saveChangeIfNewer({ ...data, changedAt });
      if (!newer) return false;

      if (followUpDate === null) {
        await repository.deletePending(consultationId);
        return true;
      }
      const scheduledAt = this.scheduledAtFor(followUpDate);
      await repository.upsertPending(consultationId, 'doctor', doctorEmail, scheduledAt);
      if (patientEmail) {
        await repository.upsertPending(consultationId, 'patient', patientEmail, scheduledAt);
      } else {
        await repository.deletePending(consultationId, 'patient');
      }
      return true;
    });

    if (!applied) {
      this.logger.info({ consultationId, changedAt: data.changedAt }, 'Old followup.changed ignored');
    }
  }

  // The reminder hour one day before the follow-up date, in the reminder time zone. When that time has
  // already passed (for example a follow-up tomorrow, set after 9 AM), the reminder is due now.
  scheduledAtFor(followUpDate) {
    const [year, month, day] = followUpDate.split('-').map(Number);
    const scheduledAt = zonedTime(year, month, day - 1, this.hour, this.timeZone);
    const now = this.now();
    return scheduledAt < now ? now : scheduledAt;
  }
}

// The moment when the clock in timeZone shows this day and hour. Date.UTC handles day 0 (the month before).
function zonedTime(year, month, day, hour, timeZone) {
  const asUtc = Date.UTC(year, month - 1, day, hour);
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
