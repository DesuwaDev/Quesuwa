import multer from 'multer';
import { t } from './i18n.js';

export const fail = (status, code, params = {}) => Object.assign(new Error(code), { status, code, params });

export function errorHandler(error, _req, res, _next) {
  if (res.headersSent) return res.end();
  let code = error.code, params = error.params || {};
  let status = error.status >= 400 && error.status <= 507 ? error.status : 500;
  if (error instanceof multer.MulterError) {
    status = 400;
    code = error.code === 'LIMIT_FILE_SIZE' ? 'errors.fileSize' : 'errors.uploadLimit';
    params = {};
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'errors.payloadTooLarge';
    params = {};
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'errors.badRequest';
    params = {};
  } else if (typeof code !== 'string' || !code.startsWith('errors.')) {
    code = status === 500 ? 'errors.server' : 'errors.badRequest';
    params = {};
  }
  if (status === 500) console.error(error);
  let message;
  try { message = t(code, params); } catch { code = 'errors.server'; params = {}; message = t(code); }
  res.status(status).json({ code, params, error: message });
}
