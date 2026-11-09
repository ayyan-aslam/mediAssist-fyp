import { z } from 'zod';

// IDs are PostgreSQL INT (SERIAL) values.
const id = z.int().positive().max(2_147_483_647);
const name = z.string().trim().min(1).max(100);
// Not checked as an email address here: a bad address fails only its own email, not the whole message.
const address = z.string().trim().min(1).max(150);

// prescription.send data (design doc 6.4.7). Only email can be sent for now.
const prescriptionSendSchema = z.object({
  prescriptionId: id,
  consultationId: id,
  doctorId: id,
  channel: z.literal('email'),
  recipient: address,
  patientName: name,
  doctorName: name,
  pdfKey: z.string().min(1).max(255),
});

// followup.changed data (design doc 6.4.9). null removes the follow-up or the patient reminder.
const followUpChangedSchema = z.object({
  consultationId: id,
  followUpDate: z.iso.date().nullable(),
  doctorId: id,
  doctorName: name,
  doctorEmail: address,
  patientName: name,
  patientEmail: address.nullable().optional().default(null),
  changedAt: z.iso.datetime({ offset: true }),
});

// A message that does not match throws, so it goes to the retry and dead-letter queues.
function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid message data: ${issue.path.join('.')}: ${issue.message}`);
  }
  return result.data;
}

export class MessageValidator {
  validatePrescriptionSend(data) {
    return parse(prescriptionSendSchema, data);
  }

  validateFollowUpChanged(data) {
    return parse(followUpChangedSchema, data);
  }
}
