import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bugTemplate, fieldTypes, choiceTypes, statuses } from '../src/shared.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const MAX_FILE = 10 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
const cleanName = raw => {
  // Browsers send UTF-8 filenames, while multipart headers default to Latin-1.
  let name = raw;
  if ([...raw].every(c => c.charCodeAt(0) <= 255)) {
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'latin1')); } catch { /* Preserve genuine Latin-1 names. */ }
  }
  return path.basename(name.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'attachment';
};
const textValue = (v, max, label, required = false) => {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw fail(400, `${label}为空或超出长度限制`);
  return v.trim();
};
function validateForm(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, '问卷格式不正确');
  const slug = textValue(body.slug, 64, '链接标识', true);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) throw fail(400, '链接标识请使用 2～64 位小写字母、数字或短横线');
  if (!['draft', 'published', 'closed'].includes(body.state)) throw fail(400, '问卷状态无效');
  if (!Array.isArray(body.fields) || body.fields.length > 30) throw fail(400, '最多设置 30 道题目');
  if (body.state === 'published' && !body.fields.length) throw fail(400, '请先添加至少一道题目');
  const ids = new Set();
  const fields = body.fields.map(f => {
    if (!f || typeof f !== 'object' || !Object.hasOwn(fieldTypes, f.type) || typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(f.id) || ['__proto__', 'constructor', 'prototype'].includes(f.id) || ids.has(f.id)) throw fail(400, '题目类型或标识无效');
    ids.add(f.id);
    let options = [];
    if (choiceTypes.includes(f.type)) {
      if (!Array.isArray(f.options) || f.options.length < 2 || f.options.length > 30) throw fail(400, '选择题需要 2～30 个选项');
      options = f.options.map(o => textValue(o, 200, '选项', true));
      if (new Set(options).size !== options.length) throw fail(400, '同一道题不能有重复选项');
    }
    return { id: f.id, type: f.type, label: textValue(f.label, 200, '题目标题', true), description: textValue(f.description ?? '', 1000, '题目说明'), required: f.required === true, options };
  });
  if (fields.filter(f => f.type === 'file').length > 2) throw fail(400, '每份问卷最多设置 2 道文件上传题');
  return { slug, state: body.state, title: textValue(body.title, 120, '问卷标题', true), description: textValue(body.description ?? '', 3000, '问卷说明'), thanks: textValue(body.thanks ?? '', 1000, '提交成功提示'), fields };
}
function safeCell(value) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function createApp({ dataDir, password, production = false, publicOrigin = '', trustProxyHops = 0, seed = true }) {
  if (!password || password.length < 16) throw new Error('ADMIN_PASSWORD must contain at least 16 characters. Configure .env first.');
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'report.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS forms (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, state TEXT NOT NULL, version INTEGER NOT NULL, definition TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms(id), snapshot TEXT NOT NULL, answers TEXT NOT NULL, attachments TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待处理', note TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS responses_form ON responses(form_id, created_at);`);
  if (seed && db.prepare('SELECT count(*) AS n FROM forms').get().n === 0) {
    const now = new Date().toISOString();
    const definition = { ...bugTemplate(), slug: 'bug-report', state: 'draft' };
    db.prepare('INSERT INTO forms VALUES (?, ?, ?, 1, ?, ?, ?)').run(randomUUID(), definition.slug, definition.state, JSON.stringify(definition), now, now);
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'blob:', 'data:'], 'script-src': ["'self'"], 'connect-src': ["'self'"], 'form-action': ["'self'"], 'object-src': ["'none'"] } } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '256kb' }));
  const originAllowed = req => {
    const origin = req.get('origin');
    if (!origin) return false;
    const expected = publicOrigin || `${req.protocol}://${req.get('host')}`;
    return origin === expected;
  };
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && !originAllowed(req)) return next(fail(403, '来源校验失败，请从本站页面重试'));
    next();
  });
  const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '操作太频繁，请稍后再试' } });
  const sessions = new Map();
  const salt = randomBytes(16);
  const passwordHash = scryptSync(password, salt, 64);
  const sessionId = req => /(?:^|;\s*)quesuwa_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: production, path: '/api/admin' };
  const requireAdmin = (req, _res, next) => {
    const token = sessionId(req);
    if (!token || (sessions.get(token) ?? 0) <= Date.now()) { if (token) sessions.delete(token); return next(fail(401, '请先登录管理后台')); }
    if (!['GET', 'HEAD'].includes(req.method) && !originAllowed(req)) return next(fail(403, '来源校验失败，请刷新页面重试'));
    next();
  };
  app.post('/api/admin/login', limiter(15 * 60_000, 10), (req, res, next) => {
    if (!originAllowed(req)) return next(fail(403, '来源校验失败'));
    const value = req.body?.password;
    if (typeof value !== 'string' || value.length > 512 || !timingSafeEqual(passwordHash, scryptSync(value, salt, 64))) return next(fail(401, '管理密码不正确'));
    for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key);
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
    const previous = sessionId(req); if (previous) sessions.delete(previous);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 8 * 3600_000);
    res.cookie('quesuwa_session', token, { ...cookieOptions, maxAge: 8 * 3600_000 }).json({ ok: true });
  });
  app.use('/api/admin', requireAdmin);
  app.get('/api/admin/session', (_req, res) => res.json({ ok: true }));
  app.post('/api/admin/logout', (req, res) => { sessions.delete(sessionId(req)); res.clearCookie('quesuwa_session', cookieOptions).json({ ok: true }); });
  const unpack = row => row && ({ ...JSON.parse(row.definition), id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, responseCount: row.response_count });
  const getForm = id => unpack(db.prepare('SELECT * FROM forms WHERE id = ?').get(id));
  app.get('/api/admin/forms', (_req, res) => res.json(db.prepare('SELECT f.*, (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS response_count FROM forms f ORDER BY created_at DESC').all().map(unpack)));
  app.post('/api/admin/forms', (req, res) => {
    const def = validateForm(req.body);
    if (db.prepare('SELECT id FROM forms WHERE slug = ?').get(def.slug)) throw fail(409, '这个链接标识已经被使用');
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO forms VALUES (?, ?, ?, 1, ?, ?, ?)').run(id, def.slug, def.state, JSON.stringify(def), now, now);
    res.status(201).json(getForm(id));
  });
  app.put('/api/admin/forms/:id', (req, res) => {
    const current = getForm(req.params.id);
    if (!current) throw fail(404, '问卷不存在');
    const def = validateForm(req.body);
    const other = db.prepare('SELECT id FROM forms WHERE slug = ? AND id != ?').get(def.slug, current.id);
    if (other) throw fail(409, '这个链接标识已经被使用');
    const result = db.prepare('UPDATE forms SET slug=?, state=?, version=version+1, definition=?, updated_at=? WHERE id=? AND version=?').run(def.slug, def.state, JSON.stringify(def), new Date().toISOString(), current.id, req.body.version ?? -1);
    if (!result.changes) throw fail(409, '问卷已被其他页面修改，请重新打开后编辑');
    res.json(getForm(current.id));
  });
  app.get('/api/forms', (_req, res) => res.json(db.prepare("SELECT * FROM forms WHERE state='published' ORDER BY created_at DESC").all().map(unpack).map(({ id, slug, title, description, fields }) => ({ id, slug, title, description, fieldCount: fields.length }))));
  app.get('/api/forms/:slug', (req, res) => {
    const form = unpack(db.prepare('SELECT * FROM forms WHERE slug=?').get(req.params.slug));
    if (!form || form.state === 'draft') throw fail(404, '问卷不存在或尚未发布');
    if (form.state === 'closed') throw fail(410, '这份问卷已结束收集，谢谢关注');
    res.json(form);
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 6, fields: 3, fieldSize: 200 * 1024, parts: 9 } }).any();
  app.post('/api/forms/:slug/responses', limiter(60 * 60_000, 12), (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(fail(415, '请使用问卷页面提交答卷'));
    const form = unpack(db.prepare("SELECT * FROM forms WHERE slug=? AND state='published'").get(req.params.slug));
    if (!form) return next(fail(404, '问卷未开放填写'));
    req.questionnaire = form;
    upload(req, res, next);
  }, async (req, res) => {
    const form = req.questionnaire;
    if (Number(req.body.version) !== form.version) throw fail(409, '问卷已更新，请刷新页面后重新填写');
    if (req.body.website) throw fail(400, '提交未通过验证');
    let incoming;
    try { incoming = JSON.parse(req.body.answers); } catch { throw fail(400, '答卷格式不正确'); }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw fail(400, '答卷格式不正确');
    const answers = Object.create(null), attachments = [], files = req.files || [];
    for (const file of files) {
      if (!form.fields.some(f => f.id === file.fieldname && f.type === 'file')) throw fail(400, '附件不属于当前问卷');
    }
    for (const f of form.fields) {
      const value = incoming[f.id];
      if (f.type === 'file') {
        const selected = files.filter(x => x.fieldname === f.id);
        if (selected.length > 3 || (f.required && !selected.length)) throw fail(400, `“${f.label}”需要上传 1～3 个文件`);
        continue;
      }
      if (f.type === 'multi') {
        const selected = value ?? [];
        if (!Array.isArray(selected) || selected.length > f.options.length || selected.some(x => !f.options.includes(x)) || new Set(selected).size !== selected.length || (f.required && !selected.length)) throw fail(400, `请检查“${f.label}”的选项`);
        answers[f.id] = selected;
      } else {
        const v = textValue(value ?? '', f.type === 'long' ? 10000 : 1000, f.label, f.required);
        if (choiceTypes.includes(f.type) && v && !f.options.includes(v)) throw fail(400, `“${f.label}”的选项无效`);
        answers[f.id] = v;
      }
    }
    for (const file of files) {
      if (!file.size) throw fail(400, '不能上传空文件');
      let kind;
      try { kind = await fileTypeFromBuffer(file.buffer); } catch { throw fail(400, '文件内容不完整或格式无效，请重新选择'); }
      let mime;
      if (kind && ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(kind.mime)) mime = kind.mime;
      else if (!kind && /\.(txt|log)$/i.test(file.originalname)) {
        try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); if (decoded.includes('\0')) throw new Error(); } catch { throw fail(400, '日志文件需要是 UTF-8 纯文本'); }
        mime = 'text/plain';
      } else throw fail(400, '仅支持 PNG、JPG、WEBP、GIF、PDF、TXT 和 LOG 文件');
      attachments.push({ id: randomUUID(), fieldId: file.fieldname, name: cleanName(file.originalname), mime, size: file.size });
    }
    // Validation may await file detection: recheck the version before writing anything.
    const latest = getForm(form.id);
    if (latest.state !== 'published' || latest.version !== form.version) throw fail(409, '问卷已更新或停止收集，请刷新页面');
    const id = randomUUID(), createdAt = new Date().toISOString(), written = [];
    try {
      attachments.forEach((a, i) => { const dest = path.join(dataDir, 'uploads', a.id); fs.writeFileSync(dest, files[i].buffer, { flag: 'wx' }); written.push(dest); });
      db.prepare('INSERT INTO responses (id, form_id, snapshot, answers, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, form.id, JSON.stringify(form), JSON.stringify(answers), JSON.stringify(attachments), createdAt);
    } catch (error) { for (const p of written) fs.rmSync(p, { force: true }); throw error; }
    res.status(201).json({ id, thanks: form.thanks || '谢谢，你的答卷已收到！' });
  });
  const parseResponse = row => ({ id: row.id, formId: row.form_id, snapshot: JSON.parse(row.snapshot), answers: JSON.parse(row.answers), attachments: JSON.parse(row.attachments), createdAt: row.created_at, status: row.status, note: row.note });
  app.get('/api/admin/forms/:id/responses', (req, res) => {
    if (!getForm(req.params.id)) throw fail(404, '问卷不存在');
    const page = Math.max(1, Math.min(1000000, parseInt(req.query.page, 10) || 1));
    const filter = statuses.includes(req.query.status) ? req.query.status : '';
    const where = 'form_id=?' + (filter ? ' AND status=?' : '');
    const params = filter ? [req.params.id, filter] : [req.params.id];
    const total = db.prepare(`SELECT count(*) AS n FROM responses WHERE ${where}`).get(...params).n;
    const items = db.prepare(`SELECT * FROM responses WHERE ${where} ORDER BY created_at DESC LIMIT 30 OFFSET ?`).all(...params, (page - 1) * 30).map(parseResponse);
    res.json({ items, total, page, pageSize: 30 });
  });
  app.patch('/api/admin/responses/:id', (req, res) => {
    if (!statuses.includes(req.body.status)) throw fail(400, '处理状态无效');
    const note = textValue(req.body.note ?? '', 10000, '内部备注');
    const result = db.prepare('UPDATE responses SET status=?, note=? WHERE id=?').run(req.body.status, note, req.params.id);
    if (!result.changes) throw fail(404, '答卷不存在');
    res.json({ ok: true });
  });
  app.get('/api/admin/responses/:id/files/:fileId', (req, res) => {
    const row = db.prepare('SELECT attachments FROM responses WHERE id=?').get(req.params.id);
    const file = row && JSON.parse(row.attachments).find(a => a.id === req.params.fileId);
    if (!file) throw fail(404, '附件不存在');
    res.set('Content-Type', file.mime);
    res.download(path.join(dataDir, 'uploads', file.id), file.name);
  });
  app.get('/api/admin/forms/:id/export', (req, res) => {
    if (!getForm(req.params.id)) throw fail(404, '问卷不存在');
    // Long format retains question labels from each response's immutable snapshot.
    res.type('text/csv; charset=utf-8').attachment('responses.csv');
    res.write('\uFEFF' + ['答卷编号', '提交时间', '处理状态', '问卷标题', '题目', '回答', '内部备注'].map(safeCell).join(',') + '\r\n');
    for (const row of db.prepare('SELECT * FROM responses WHERE form_id=? ORDER BY created_at DESC').iterate(req.params.id)) {
      const r = parseResponse(row);
      for (const f of r.snapshot.fields) {
        const value = f.type === 'file' ? r.attachments.filter(a => a.fieldId === f.id).map(a => a.name).join('；') : Array.isArray(r.answers[f.id]) ? r.answers[f.id].join('；') : r.answers[f.id];
        res.write([r.id, r.createdAt, r.status, r.snapshot.title, f.label, value, r.note].map(safeCell).join(',') + '\r\n');
      }
    }
    res.end();
  });
  app.use('/api', (_req, _res, next) => next(fail(404, '接口不存在')));
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get(['/', '/admin', '/f/:slug'], (_req, res) => {
    if (!fs.existsSync(path.join(dist, 'index.html'))) return res.status(503).type('text').send('Frontend is not built. Run npm run build, or use the Vite development URL.');
    res.sendFile(path.join(dist, 'index.html'));
  });
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '每个文件不能超过 10 MB' : '附件或表单超出限制：每题最多 3 个附件，总计最多 6 个' });
    const status = error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? '服务器暂时无法处理，请稍后重试' : error.message });
  });
  return { app, close: () => db.close() };
}
