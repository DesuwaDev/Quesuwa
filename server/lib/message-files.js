// Files attached to conversation messages: images, PDFs, text logs and short videos.
// They are checked like questionnaire uploads and count towards the same storage quota.
import multer from 'multer';
import { LIMITS } from '../../shared/constants.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.fileMB * 1024 * 1024, files: LIMITS.messageFiles, fields: 5, fieldSize: 64 * 1024, parts: LIMITS.messageFiles + 5 }
}).array('files', LIMITS.messageFiles);

// Message endpoints accept plain JSON, or multipart with a "body" field and files.
export const messageBody = (req, res, next) => req.is('multipart/form-data') ? upload(req, res, next) : next();

// Validates and writes the uploaded files; call rollback() if storing the message fails.
export async function storeMessageFiles(storage, files) {
  if (!files?.length) return { attachments: [], rollback: () => {} };
  const field = { id: 'message', label: '', maxFileMB: LIMITS.fileMB };
  const attachments = [];
  for (const file of files) attachments.push(await storage.inspect(file, field));
  storage.ensureCapacity(files.reduce((sum, file) => sum + file.size, 0));
  return { attachments, rollback: storage.write(attachments, files.map(file => file.buffer)) };
}
