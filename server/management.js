import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { statuses } from '../src/shared.js';

export function migrateManagement(db) {
  for (const table of ['forms', 'responses']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'deleted_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS file_cleanup (id TEXT PRIMARY KEY);
    CREATE INDEX IF NOT EXISTS responses_active ON responses(form_id, deleted_at, created_at);`);
}
export function registerManagement(app, { db, getForm, validateForm, fail, dataDir, maxStorageMB }) {
  const audit = (action, target) => {
    db.prepare('INSERT INTO audit(action,target,created_at) VALUES (?,?,?)').run(action, target, new Date().toISOString());
    db.exec('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 1000)');
  };
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function cleanup() {
    for (const { id } of db.prepare('SELECT id FROM file_cleanup').all()) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try { fs.rmSync(path.join(dataDir, 'uploads', id), { force: true }); db.prepare('DELETE FROM file_cleanup WHERE id=?').run(id); }
      catch (error) { console.error(error); }
    }
  }
  cleanup();
  const requireForm = id => {
    const form = getForm(id);
    if (!form) throw fail(404, 'errors.formNotFound');
    return form;
  };
  function queueFiles(rows) {
    const insert = db.prepare('INSERT OR IGNORE INTO file_cleanup(id) VALUES (?)');
    for (const row of rows) for (const file of JSON.parse(row.attachments)) insert.run(file.id);
  }
  app.post('/api/admin/forms/:id/duplicate', (req, res) => {
    const form = requireForm(req.params.id);
    const id = randomUUID(), now = new Date().toISOString();
    const def = validateForm({ ...form, state: 'draft', slug: `survey-${id.slice(0, 12)}` });
    db.prepare('INSERT INTO forms(id,slug,state,version,definition,created_at,updated_at) VALUES (?,?,?,1,?,?,?)').run(id, def.slug, def.state, JSON.stringify(def), now, now);
    audit('duplicate', id);
    res.status(201).json(getForm(id));
  });
  app.delete('/api/admin/forms/:id', (req, res) => {
    const form = requireForm(req.params.id);
    if (req.query.permanent === 'true') {
      if (!form.deletedAt || req.body?.confirmation !== form.title) throw fail(400, 'errors.deleteConfirm');
      transaction(() => {
        queueFiles(db.prepare('SELECT attachments FROM responses WHERE form_id=?').all(form.id));
        db.prepare('DELETE FROM responses WHERE form_id=?').run(form.id);
        db.prepare('DELETE FROM forms WHERE id=?').run(form.id);
        audit('purgeForm', form.id);
      });
      cleanup();
    } else {
      const now = new Date().toISOString();
      db.prepare('UPDATE forms SET deleted_at=?, version=version+1, updated_at=? WHERE id=? AND deleted_at IS NULL').run(now, now, form.id);
      audit('trashForm', form.id);
    }
    res.json({ ok: true });
  });
  app.post('/api/admin/forms/:id/restore', (req, res) => {
    const form = requireForm(req.params.id);
    if (!form.deletedAt) throw fail(400, 'errors.badRequest');
    const definition = { ...form, state: 'draft' };
    db.prepare("UPDATE forms SET deleted_at=NULL,state='draft',definition=?,version=version+1,updated_at=? WHERE id=?").run(JSON.stringify(validateForm(definition)), new Date().toISOString(), form.id);
    audit('restoreForm', form.id);
    res.json(getForm(form.id));
  });
  app.post('/api/admin/forms/:id/responses/batch', (req, res) => {
    const form = requireForm(req.params.id);
    const { ids, action, status } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || id.length > 64)) throw fail(400, 'errors.badRequest');
    if (!['status', 'trash', 'restore', 'purge'].includes(action) || (action === 'status' && !statuses.includes(status))) throw fail(400, 'errors.badRequest');
    const rows = ids.map(id => db.prepare('SELECT * FROM responses WHERE id=? AND form_id=?').get(id, form.id));
    if (rows.some(row => !row)) throw fail(404, 'errors.responseNotFound');
    if (action === 'purge' && (rows.some(row => !row.deleted_at) || req.body.confirmation !== form.title)) throw fail(400, 'errors.deleteConfirm');
    transaction(() => {
      for (const row of rows) {
        if (action === 'status') db.prepare('UPDATE responses SET status=? WHERE id=?').run(status, row.id);
        if (action === 'trash') db.prepare('UPDATE responses SET deleted_at=? WHERE id=?').run(new Date().toISOString(), row.id);
        if (action === 'restore') db.prepare('UPDATE responses SET deleted_at=NULL WHERE id=?').run(row.id);
        if (action === 'purge') { queueFiles([row]); db.prepare('DELETE FROM responses WHERE id=?').run(row.id); }
      }
      audit(action, form.id);
    });
    cleanup();
    res.json({ ok: true, count: rows.length });
  });
  app.get('/api/admin/forms/:id/statistics', (req, res) => {
    const form = requireForm(req.params.id);
    const rows = db.prepare('SELECT answers,snapshot,created_at,status FROM responses WHERE form_id=? AND deleted_at IS NULL ORDER BY created_at').iterate(form.id);
    const days = {}, byStatus = {}, fields = {};
    let total = 0;
    for (const row of rows) {
      total++;
      const day = row.created_at.slice(0, 10);
      days[day] = (days[day] || 0) + 1;
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      const answers = JSON.parse(row.answers);
      for (const f of JSON.parse(row.snapshot).fields) {
        if (!['single', 'multi', 'select', 'rating', 'number'].includes(f.type)) continue;
        const key = `${f.id}:${f.type}:${f.label}`;
        const stats = fields[key] ||= { label: f.label, type: f.type, count: 0, sum: 0, options: {} };
        const value = answers[f.id];
        if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) continue;
        stats.count++;
        if (['number', 'rating'].includes(f.type)) stats.sum += Number(value);
        else for (const option of Array.isArray(value) ? value : [value]) Object.defineProperty(stats.options, option, { value: (Object.hasOwn(stats.options, option) ? stats.options[option] : 0) + 1, enumerable: true, configurable: true });
      }
    }
    res.json({ total, days, byStatus, fields: Object.values(fields) });
  });
  app.get('/api/admin/forms/:id/definition', (req, res) => {
    const form = requireForm(req.params.id);
    res.attachment('questionnaire.json').json(validateForm({ ...form, state: 'draft' }));
  });
  app.get('/api/admin/system', (_req, res) => {
    const attachmentRows = db.prepare('SELECT attachments FROM responses').iterate();
    let bytes = 0, files = 0;
    for (const row of attachmentRows) for (const file of JSON.parse(row.attachments)) { bytes += file.size; files++; }
    res.json({ forms: db.prepare('SELECT count(*) AS n FROM forms WHERE deleted_at IS NULL').get().n,
      responses: db.prepare('SELECT count(*) AS n FROM responses WHERE deleted_at IS NULL').get().n,
      files, bytes, maxStorageMB, databaseBytes: fs.statSync(path.join(dataDir, 'report.sqlite')).size,
      pendingCleanup: db.prepare('SELECT count(*) AS n FROM file_cleanup').get().n,
      events: db.prepare('SELECT action,target,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 100').all() });
  });
  return { audit, cleanup };
}
