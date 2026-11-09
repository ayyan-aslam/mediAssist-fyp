import { AppError } from '@mediassist/common';
import { z } from 'zod';

// IDs are PostgreSQL INT (SERIAL) values.
const MAX_ID = 2_147_483_647;
const id = z.int().positive().max(MAX_ID);

const finalizeSchema = z.object({ consultationId: id });
// Query values arrive as strings.
const byConsultationSchema = z.object({ consultationId: z.coerce.number().pipe(id) });
// Any channel name is accepted here; the service refuses all but email with CHANNEL_NOT_AVAILABLE.
const sendSchema = z.object({ channel: z.string().trim().min(1).max(20) });

// Lists and pages (design doc 5.1.2).
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// delivery.result data (design doc 6.4.8). Only the fields this service uses are checked.
const deliveryResultSchema = z.object({
  prescriptionId: id,
  requestMessageId: z.uuid(),
  status: z.enum(['sent', 'failed']),
  errorMessage: z.string().nullable().optional().default(null),
});

function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    throw new AppError(400, 'VALIDATION_ERROR', path ? `${path}: ${issue.message}` : issue.message);
  }
  return result.data;
}

export class RequestValidator {
  validateFinalize(body) {
    return parse(finalizeSchema, body);
  }

  validateByConsultation(query) {
    return parse(byConsultationSchema, query);
  }

  validateSend(body) {
    return parse(sendSchema, body);
  }

  validateList(query) {
    return parse(listSchema, query);
  }

  validateDeliveryResult(data) {
    return parse(deliveryResultSchema, data);
  }

  // An ID in the URL. A value that is not a valid ID cannot exist, so it is not found.
  parseId(value, notFoundError) {
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || parsed <= 0 || parsed > MAX_ID) {
      throw notFoundError();
    }
    return parsed;
  }
}
