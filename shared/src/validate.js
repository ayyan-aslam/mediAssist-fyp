import { AppError } from './errors.js';

function firstIssueMessage(error) {
  const issue = error.issues[0];
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

// Checks req.body, req.params or req.query against a zod schema.
// On success the parsed data replaces the original, so defaults and coercions apply.
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError(400, 'VALIDATION_ERROR', firstIssueMessage(result.error)));
    }

    if (source === 'query') {
      // In Express 5 req.query is a read-only getter, so it is replaced on this request only.
      Object.defineProperty(req, 'query', { value: result.data, writable: true });
    } else {
      req[source] = result.data;
    }
    return next();
  };
}
