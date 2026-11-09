import { AppError } from '@mediassist/common';
import { z } from 'zod';
import { ACTIONS } from './MessageValidator.js';

// IDs are PostgreSQL INT (SERIAL) values. Query values arrive as strings.
const id = z.coerce.number().int().positive().max(2_147_483_647);

// GET /admin/audit-logs?from=2026-10-01&to=2026-10-07&userId=16&action=login&page=1&pageSize=20
// (design doc 5.10). All optional.
const auditLogListSchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    userId: id.optional(),
    action: z.enum(ACTIONS).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { message: 'must not be after to', path: ['from'] });

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
  validateAuditLogList(query) {
    return parse(auditLogListSchema, query);
  }
}
