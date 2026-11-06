import { AppError } from '@mediassist/common';
import multer from 'multer';

const MAX_PART_BYTES = 2 * 1024 * 1024;

// Browsers send "audio/webm" or "audio/webm;codecs=opus".
const isWebm = (mimetype) => mimetype.split(';')[0].trim().toLowerCase() === 'audio/webm';

const fileTypeError = () => new AppError(400, 'FILE_TYPE_NOT_SUPPORTED', 'The audio must be a WebM file.');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PART_BYTES, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => (isWebm(file.mimetype) ? cb(null, true) : cb(fileTypeError())),
}).single('audio');

// Reads the multipart form of POST /consultations/{id}/audio-parts: the audio file into memory
// (req.file) and the text fields into req.body. Multer errors use the shared error format.
export function audioUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(400, 'FILE_TOO_LARGE', 'An audio part can be up to 2 MB.'));
    }
    if (err instanceof multer.MulterError) {
      return next(new AppError(400, 'VALIDATION_ERROR', `${err.field ?? 'form'}: ${err.message}`));
    }
    return next(err);
  });
}
