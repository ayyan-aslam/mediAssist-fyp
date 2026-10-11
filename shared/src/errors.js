// Error format and HTTP statuses: design doc Section 5.1.3.

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

// Must be the last middleware of the app.
export function errorHandler(logger) {
  // Express needs all four arguments to treat this as an error handler.
  return (err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    if (err instanceof AppError) {
      return sendError(res, err.status, err.code, err.message);
    }

    // Invalid JSON body, rejected by express.json().
    if (err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'The request body is not valid JSON.');
    }

    logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
    return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  };
}
