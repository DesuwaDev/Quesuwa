import express from 'express';
import { configureAuth } from './auth.js';
import { normalizeSettings, normalizeRules, visibleFields, answerError } from '../src/form-rules.js';
import { migrateManagement, registerManagement } from './management.js';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldTypes, choiceTypes, statuses, statusKeys } from '../src/shared.js';

import { t, localeMiddleware } from './i18n.js';
import legacyStatuses from '../i18n/legacy-statuses.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const MAX_FILE = 10 * 1024 * 1024;
const fail = (status, code, params = {}) => Object.assign(new Error(code), { status, code, params });
const cleanName = raw => {
  // Browsers send UTF-8 filenames, while multipart headers default to Latin-1.
  let name = raw;
  if ([...raw].every(c => c.charCodeAt(0) <= 255)) {
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'latin1')); } catch { /* Preserve genuine Latin-1 names. */ }
  }
  return path.basename(name.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'attachment';
};
const textValue = (v, max, label, required = false) => {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw fail(400, 'errors.textInvalid', { label });
  return v.trim();
};
function validateForm(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'errors.formInvalid');
  const slug = textValue(body.slug, 64, t('labels.slug'), true);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) throw fail(400, 'errors.slugInvalid');
  if (!['draft', 'published', 'closed'].includes(body.state)) throw fail(400, 'errors.stateInvalid');
  if (!Array.isArray(body.fields) || body.fields.length > 30) throw fail(400, 'errors.tooManyFields');
  if (body.state === 'published' && !body.fields.length) throw fail(400, 'errors.noFields');
  const ids = new Set();
  const fields = [];
  for (const f of body.fields) {
    if (!f || typeof f !== 'object' || !Object.hasOwn(fieldTypes, f.type) || typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(f.id) || ['__proto__', 'constructor', 'prototype'].includes(f.id) || ids.has(f.id)) throw fail(400, 'errors.fieldInvalid');
    ids.add(f.id);
    let options = [];
    if (choiceTypes.includes(f.type)) {
      if (!Array.isArray(f.options) || f.options.length < 2 || f.options.length > 30) throw fail(400, 'errors.optionCount');
      options = f.options.map(o => textValue(o, 200, t('labels.option'), true));
      if (new Set(options).size !== options.length) throw fail(400, 'errors.duplicateOptions');
    }
    fields.push({ ...normalizeRules(f, fields), id: f.id, type: f.type, label: textValue(f.label, 200, t('labels.question'), true), description: textValue(f.description ?? '', 1000, t('labels.questionDescription')), required: f.required === true, options });
  }
  if (fields.filter(f => f.type === 'file').length > 2) throw fail(400, 'errors.fileFieldCount');
  return { settings: normalizeSettings(body.settings), slug, state: body.state, title: textValue(body.title, 120, t('csv.title'), true), description: textValue(body.description ?? '', 3000, t('labels.description')), thanks: textValue(body.thanks ?? '', 1000, t('labels.thanks')), fields };
}
function safeCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function createApp({ dataDir, password, production = false, publicOrigin = '', trustProxyHops = 0, maxStorageMB = 1024 }) {
  if (!password || password.length < 16) throw new Error(t('cli.passwordRequired'));
  if (production) {
    let origin;
    try { origin = new URL(publicOrigin); } catch { throw new Error(t('errors.productionOrigin')); }
    if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw new Error(t('errors.productionOrigin'));
  }
  if (!Number.isInteger(maxStorageMB) || maxStorageMB < 1 || maxStorageMB > 1048576) throw new Error(t('errors.storageConfig'));
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'report.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS forms (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, state TEXT NOT NULL, version INTEGER NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id), snapshot TEXT NOT NULL, answers TEXT NOT NULL, attachments TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS responses_form ON responses(form_id, created_at);`);
  migrateManagement(db);
  db.exec('PRAGMA busy_timeout=5000;');
  const migrateStatus = db.prepare('UPDATE responses SET status=? WHERE status=?');
  for (const [legacy, code] of Object.entries(legacyStatuses)) migrateStatus.run(code, legacy);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'blob:', 'data:'], 'script-src': ["'self'"], 'connect-src': ["'self'"], 'form-action': ["'self'"], 'object-src': ["'none'"] } } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(localeMiddleware);
  app.use(express.json({ limit: '256kb' }));
  const originAllowed = req => {
    const origin = req.get('origin');
    if (!origin) return false;
    const expected = publicOrigin || `${req.protocol}://${req.get('host')}`;
    return origin === expected;
  };
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && !originAllowed(req)) return next(fail(403, 'errors.origin'));
    next();
  });
  const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ code: 'errors.rateLimit', error: t('errors.rateLimit') }) });
  const { sessions, verify, setPassword, hashToken } = configureAuth(db, password);
  const sessionId = req => /(?:^|;\s*)quesuwa_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: production, path: '/api/admin' };
  const requireAdmin = (req, _res, next) => {
    const token = sessionId(req);
    if (!token || (sessions.get(token) ?? 0) <= Date.now()) { if (token) sessions.delete(token); return next(fail(401, 'errors.loginRequired')); }
    if (!['GET', 'HEAD'].includes(req.method) && !originAllowed(req)) return next(fail(403, 'errors.origin'));
    next();
  };
  app.post('/api/admin/login', limiter(15 * 60_000, 10), async (req, res, next) => {
    if (!originAllowed(req)) return next(fail(403, 'errors.origin'));
    const value = req.body?.password;
    if (!await verify(value)) return next(fail(401, 'errors.password'));
    sessions.prune();
    const previous = sessionId(req); if (previous) sessions.delete(previous);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 8 * 3600_000);
    res.cookie('quesuwa_session', token, { ...cookieOptions, maxAge: 8 * 3600_000 }).json({ ok: true });
  });
  app.use('/api/admin', requireAdmin);
  app.get('/api/admin/sessions', (req, res) => {
    const current = hashToken(sessionId(req));
    res.json(db.prepare('SELECT token,created_at AS createdAt,expires_at AS expiresAt FROM admin_sessions WHERE expires_at>? ORDER BY created_at DESC').all(Date.now()).map(({ token, ...session }) => ({ ...session, current: token === current })));
  });
  app.post('/api/admin/sessions/revoke', (req, res) => {
    db.prepare('DELETE FROM admin_sessions WHERE token<>?').run(hashToken(sessionId(req)));
    res.json({ ok: true });
  });
  app.post('/api/admin/password', limiter(15 * 60_000, 5), async (req, res) => {
    const nextPassword = req.body?.newPassword;
    if (typeof nextPassword !== 'string' || nextPassword.length < 16 || nextPassword.length > 128) throw fail(400, 'errors.passwordLength');
    if (!await verify(req.body.currentPassword)) throw fail(403, 'errors.password');
    db.exec('BEGIN IMMEDIATE');
    try { setPassword(nextPassword); sessions.clear(); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    res.clearCookie('quesuwa_session', cookieOptions).json({ ok: true });
  });
  app.get('/api/admin/session', (_req, res) => res.json({ ok: true }));
  app.post('/api/admin/logout', (req, res) => { sessions.delete(sessionId(req)); res.clearCookie('quesuwa_session', cookieOptions).json({ ok: true }); });
  const unpack = row => row && ({ ...JSON.parse(row.definition), id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, responseCount: row.response_count, deletedAt: row.deleted_at });
  const getForm = id => unpack(db.prepare('SELECT * FROM forms WHERE id = ?').get(id));
  const { audit } = registerManagement(app, { db, getForm, validateForm, fail, dataDir, maxStorageMB });
  app.get('/api/admin/forms', (req, res) => res.json(db.prepare('SELECT f.*, (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id AND r.deleted_at IS NULL) AS response_count FROM forms f WHERE ' + (req.query.trash === 'true' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL') + ' ORDER BY created_at DESC').all().map(unpack)));
  app.post('/api/admin/forms', (req, res) => {
    const def = validateForm(req.body);
    if (db.prepare('SELECT id FROM forms WHERE slug = ?').get(def.slug)) throw fail(409, 'errors.slugTaken');
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO forms(id,slug,state,version,definition,created_at,updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)').run(id, def.slug, def.state, JSON.stringify(def), now, now);
    audit('createForm', id);
    res.status(201).json(getForm(id));
  });
  app.put('/api/admin/forms/:id', (req, res) => {
    const current = getForm(req.params.id);
    if (!current || current.deletedAt) throw fail(404, 'errors.formNotFound');
    const def = validateForm(req.body);
    const other = db.prepare('SELECT id FROM forms WHERE slug = ? AND id != ?').get(def.slug, current.id);
    if (other) throw fail(409, 'errors.slugTaken');
    const result = db.prepare('UPDATE forms SET slug=?, state=?, version=version+1, definition=?, updated_at=? WHERE id=? AND version=?').run(def.slug, def.state, JSON.stringify(def), new Date().toISOString(), current.id, req.body.version ?? -1);
    if (!result.changes) throw fail(409, 'errors.editConflict');
    audit('updateForm', current.id);
    res.json(getForm(current.id));
  });
  const checkOpen = form => {
    if (!form || form.deletedAt || form.state === 'draft') throw fail(404, 'errors.formUnavailable');
    if (form.state !== 'published') throw fail(410, 'errors.formClosed');
    const settings = normalizeSettings(form.settings);
    const now = Date.now();
    if ((settings.startsAt && now < Date.parse(settings.startsAt)) || (settings.endsAt && now >= Date.parse(settings.endsAt))) throw fail(410, 'errors.outsideSchedule');
    if (settings.responseLimit && db.prepare('SELECT count(*) AS n FROM responses WHERE form_id=?').get(form.id).n >= settings.responseLimit) throw fail(410, 'errors.responseLimit');
  };
  app.get('/api/forms', (_req, res) => res.json(db.prepare("SELECT * FROM forms WHERE state='published' AND deleted_at IS NULL ORDER BY created_at DESC").all().map(unpack).filter(form => { if (!form.settings?.listed) return false; try { checkOpen(form); return true; } catch { return false; } }).map(({ id, slug, title, description, fields }) => ({ id, slug, title, description, fieldCount: fields.length }))));
  app.get('/api/forms/:slug', (req, res) => {
    const form = unpack(db.prepare('SELECT * FROM forms WHERE slug=?').get(req.params.slug));
    checkOpen(form);
    res.json(form);
  });
  let activeUploads = 0;
  const uploadSlots = (_req, res, next) => {
    if (activeUploads >= 4) return next(fail(503, 'errors.uploadBusy'));
    activeUploads++;
    let released = false;
    const release = () => { if (!released) { released = true; activeUploads--; } };
    res.once('finish', release); res.once('close', release); next();
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 6, fields: 4, fieldSize: 400 * 1024, parts: 10 } }).any();
  app.post('/api/forms/:slug/responses', limiter(60 * 60_000, 12), uploadSlots, (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(fail(415, 'errors.multipart'));
    const form = unpack(db.prepare("SELECT * FROM forms WHERE slug=? AND state='published' AND deleted_at IS NULL").get(req.params.slug));
    if (!form) return next(fail(404, 'errors.formNotOpen'));
    checkOpen(form);
    req.questionnaire = form;
    upload(req, res, next);
  }, async (req, res) => {
    const form = req.questionnaire;
    if (Number(req.body.version) !== form.version) throw fail(409, 'errors.versionConflict');
    if (req.body.website) throw fail(400, 'errors.verification');
    let incoming;
    try { incoming = JSON.parse(req.body.answers); } catch { throw fail(400, 'errors.answersInvalid'); }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw fail(400, 'errors.answersInvalid');
    if (form.settings?.consentText && req.body.consent !== 'true') throw fail(400, 'errors.consent');
    const activeFields = visibleFields(form.fields, incoming);
    const answers = Object.create(null), attachments = [], files = req.files || [];
    for (const file of files) {
      if (!activeFields.some(f => f.id === file.fieldname && f.type === 'file')) throw fail(400, 'errors.fileField');
    }
    for (const f of activeFields) {
      const value = incoming[f.id];
      if (f.type === 'file') {
        const selected = files.filter(x => x.fieldname === f.id);
        if (selected.length > (f.maxFiles || 3) || (f.required && !selected.length)) throw fail(400, 'errors.fileCount', { label: f.label });
        continue;
      }
      if (f.type === 'multi') {
        const selected = value ?? [];
        if (!Array.isArray(selected) || selected.length > f.options.length || selected.some(x => !f.options.includes(x)) || new Set(selected).size !== selected.length || (f.required && !selected.length)) throw fail(400, 'errors.choices', { label: f.label });
        answers[f.id] = selected;
      } else {
        const v = textValue(value ?? '', f.maxLength || (f.type === 'long' ? 10000 : 1000), f.label, f.required);
        if (choiceTypes.includes(f.type) && v && !f.options.includes(v)) throw fail(400, 'errors.choice', { label: f.label });
        const invalid = answerError(f, v);
        if (invalid) throw fail(400, invalid);
        answers[f.id] = v;
      }
    }
    for (const file of files) {
      if (!file.size) throw fail(400, 'errors.emptyFile');
      const field = activeFields.find(f => f.id === file.fieldname);
      if (file.size > (field.maxFileMB || 10) * 1024 * 1024) throw fail(400, 'errors.customFileLimit');
      let kind;
      try { kind = await fileTypeFromBuffer(file.buffer); } catch { throw fail(400, 'errors.invalidFile'); }
      let mime;
      if (kind && ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(kind.mime)) mime = kind.mime;
      else if (!kind && /\.(txt|log)$/i.test(file.originalname)) {
        try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); if (decoded.includes('\0')) throw new Error(); } catch { throw fail(400, 'errors.textFile'); }
        mime = 'text/plain';
      } else throw fail(400, 'errors.fileType');
      const group = mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : 'text';
      if (field.fileKinds && !field.fileKinds.includes(group)) throw fail(400, 'errors.fileType');
      attachments.push({ id: randomUUID(), fieldId: file.fieldname, name: cleanName(file.originalname), mime, size: file.size });
    }
    // Validation may await file detection: recheck the version before writing anything.
    const latest = getForm(form.id);
    checkOpen(latest);
    if (latest.version !== form.version) throw fail(409, 'errors.formChanged');
    const incomingBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (incomingBytes) {
      const used = db.prepare("SELECT COALESCE(SUM(json_extract(a.value,'$.size')),0) AS bytes FROM responses r, json_each(r.attachments) a").get().bytes;
      if (used + incomingBytes > maxStorageMB * 1024 * 1024) throw fail(507, 'errors.storageFull');
    }
    const id = randomUUID(), createdAt = new Date().toISOString(), written = [];
    try {
      attachments.forEach((a, i) => { const dest = path.join(dataDir, 'uploads', a.id); fs.writeFileSync(dest, files[i].buffer, { flag: 'wx' }); written.push(dest); });
      db.prepare('INSERT INTO responses (id, form_id, snapshot, answers, attachments, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, form.id, JSON.stringify(form), JSON.stringify(answers), JSON.stringify(attachments), createdAt, 'pending');
    } catch (error) { for (const p of written) fs.rmSync(p, { force: true }); throw error; }
    res.status(201).json({ id, thanks: form.thanks || t('common.thanks'), thanksKey: form.thanks ? null : 'common.thanks' });
  });
  const parseResponse = row => ({ id: row.id, formId: row.form_id, snapshot: JSON.parse(row.snapshot), answers: JSON.parse(row.answers), attachments: JSON.parse(row.attachments), createdAt: row.created_at, status: row.status, note: row.note, deletedAt: row.deleted_at });
  app.get('/api/admin/forms/:id/responses', (req, res) => {
    if (!getForm(req.params.id)) throw fail(404, 'errors.formNotFound');
    const page = Math.max(1, Math.min(1000000, parseInt(req.query.page, 10) || 1));
    const filter = statuses.includes(req.query.status) ? req.query.status : '';
    const search = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const where = 'form_id=? AND deleted_at IS ' + (req.query.trash === 'true' ? 'NOT NULL' : 'NULL') + (filter ? ' AND status=?' : '') + (search ? ' AND (instr(answers,?)>0 OR instr(note,?)>0 OR instr(id,?)>0)' : '');
    const params = filter ? [req.params.id, filter] : [req.params.id];
    if (search) params.push(search, search, search);
    const total = db.prepare(`SELECT count(*) AS n FROM responses WHERE ${where}`).get(...params).n;
    const items = db.prepare(`SELECT * FROM responses WHERE ${where} ORDER BY created_at DESC LIMIT 30 OFFSET ?`).all(...params, (page - 1) * 30).map(parseResponse);
    res.json({ items, total, page, pageSize: 30 });
  });
  app.patch('/api/admin/responses/:id', (req, res) => {
    if (!statuses.includes(req.body.status)) throw fail(400, 'errors.statusInvalid');
    const note = textValue(req.body.note ?? '', 10000, t('csv.note'));
    const result = db.prepare('UPDATE responses SET status=?, note=? WHERE id=? AND deleted_at IS NULL').run(req.body.status, note, req.params.id);
    if (!result.changes) throw fail(404, 'errors.responseNotFound');
    res.json({ ok: true });
  });
  app.get('/api/admin/responses/:id/files/:fileId', (req, res) => {
    const row = db.prepare('SELECT attachments FROM responses WHERE id=?').get(req.params.id);
    const file = row && JSON.parse(row.attachments).find(a => a.id === req.params.fileId);
    if (!file) throw fail(404, 'errors.fileNotFound');
    res.set('Content-Type', file.mime);
    res.download(path.join(dataDir, 'uploads', file.id), file.name);
  });
  app.get('/api/admin/forms/:id/export', (req, res) => {
    if (!getForm(req.params.id)) throw fail(404, 'errors.formNotFound');
    // Long format retains question labels from each response's immutable snapshot.
    res.type('text/csv; charset=utf-8').attachment('responses.csv');
    res.write('\uFEFF' + [t('csv.id'), t('csv.time'), t('csv.status'), t('csv.title'), t('csv.question'), t('csv.answer'), t('csv.note')].map(safeCell).join(',') + '\r\n');
    for (const row of db.prepare('SELECT * FROM responses WHERE form_id=? AND deleted_at IS NULL ORDER BY created_at DESC').iterate(req.params.id)) {
      const r = parseResponse(row);
      for (const f of r.snapshot.fields) {
        const value = f.type === 'file' ? r.attachments.filter(a => a.fieldId === f.id).map(a => a.name).join(t('csv.separator')) : Array.isArray(r.answers[f.id]) ? r.answers[f.id].join(t('csv.separator')) : r.answers[f.id];
        res.write([r.id, r.createdAt, t(statusKeys[r.status]), r.snapshot.title, f.label, value, r.note].map(safeCell).join(',') + '\r\n');
      }
    }
    res.end();
  });
  app.get('/api/health', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });
  app.use('/api', (_req, _res, next) => next(fail(404, 'errors.routeNotFound')));
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get(['/', '/admin', '/f/:slug'], (_req, res) => {
    if (!fs.existsSync(path.join(dist, 'index.html'))) return res.status(503).type('text').send(t('errors.frontendMissing'));
    res.sendFile(path.join(dist, 'index.html'));
  });
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    let code = error.code, params = error.params || {};
    let status = error.status >= 400 && error.status <= 507 ? error.status : 500;
    if (error instanceof multer.MulterError) {
      status = 400;
      code = error.code === 'LIMIT_FILE_SIZE' ? 'errors.fileSize' : 'errors.uploadLimit';
    } else if (!code || !code.startsWith('errors.')) {
      code = status === 500 ? 'errors.server' : 'errors.badRequest';
      params = {};
    }
    if (status === 500) console.error(error);
    res.status(status).json({ code, params, error: t(code, params) });
  });
  return { app, close: () => db.close() };
}
