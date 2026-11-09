import { z } from 'zod';

// AUDIT_LOG.action (design doc 4.6 and 6.4.12).
export const ACTIONS = ['login', 'logout', 'document_upload', 'soap_note_change', 'prescription_send', 'account_suspension'];

// IDs are PostgreSQL INT (SERIAL) values.
const id = z.int().positive().max(2_147_483_647);

// audit.event (design doc 6.3 and 6.4.12). A details text over 255 characters is cut instead of refused,
// so the action is still logged.
const auditEventSchema = z.object({
  messageId: z.uuid(),
  data: z.object({
    userId: id,
    action: z.enum(ACTIONS),
    details: z
      .string()
      .nullable()
      .optional()
      .transform((value) => value?.slice(0, 255) || null),
    ipAddress: z.string().trim().min(1).max(45),
    occurredAt: z.iso.datetime({ offset: true }),
  }),
});

// A message that does not match throws, so it goes to the retry and dead-letter queues.
function parse(schema, message) {
  const result = schema.safeParse(message ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid message: ${issue.path.join('.')}: ${issue.message}`);
  }
  return result.data;
}

export class MessageValidator {
  // Returns { messageId, userId, action, details, ipAddress, occurredAt }.
  validateAuditEvent(message) {
    const { messageId, data } = parse(auditEventSchema, message);
    return { messageId, ...data };
  }
}
