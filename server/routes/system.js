import { Router } from 'express';
import { t } from '../i18n.js';
import { parseResponse, summarize } from '../services/responses.js';
import { dayKey, daySeries, parseOffset } from '../services/statistics.js';
import { appVersion } from '../version.js';

export function overviewRoutes({ db }) {
  const router = Router();
  router.get('/overview', (req, res) => {
    const tz = parseOffset(req.query.tz);
    const today = dayKey(new Date().toISOString(), tz);
    const start = new Date(Date.parse(today + 'T00:00:00Z') - 29 * 86400_000).toISOString().slice(0, 10);
    const since = new Date(Date.parse(start + 'T00:00:00Z') + tz * 60000).toISOString();
    const states = Object.fromEntries(db.prepare('SELECT state, count(*) AS n FROM forms WHERE deleted_at IS NULL GROUP BY state').all().map(row => [row.state, row.n]));
    const counts = new Map();
    for (const row of db.prepare('SELECT r.created_at FROM responses r JOIN forms f ON f.id=r.form_id WHERE r.deleted_at IS NULL AND f.deleted_at IS NULL AND r.created_at>=?').iterate(since)) {
      const key = dayKey(row.created_at, tz);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const trend = daySeries(counts, start, today);
    const separator = t('common.listSeparator');
    const recent = db.prepare('SELECT r.*, f.definition AS form_definition FROM responses r JOIN forms f ON f.id=r.form_id WHERE r.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 8').all().map(row => {
      const response = parseResponse(row);
      return { id: response.id, formId: response.formId, formTitle: JSON.parse(row.form_definition).title, createdAt: response.createdAt, status: response.status, starred: response.starred, summary: summarize(response, separator), attachments: response.attachments.length };
    });
    const top = db.prepare(`SELECT f.id, f.definition, f.state, count(r.id) AS n FROM forms f JOIN responses r ON r.form_id=f.id AND r.deleted_at IS NULL AND r.created_at>=?
      WHERE f.deleted_at IS NULL GROUP BY f.id ORDER BY n DESC LIMIT 5`).all(since).map(row => ({ id: row.id, title: JSON.parse(row.definition).title, state: row.state, count: row.n }));
    const totals = db.prepare(`SELECT count(*) AS total, SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN r.starred=1 THEN 1 ELSE 0 END) AS starred, SUM(CASE WHEN r.unread=1 THEN 1 ELSE 0 END) AS unread
      FROM responses r JOIN forms f ON f.id=r.form_id WHERE r.deleted_at IS NULL AND f.deleted_at IS NULL`).get();
    res.json({
      forms: { total: Object.values(states).reduce((a, b) => a + b, 0), draft: states.draft || 0, published: states.published || 0, closed: states.closed || 0 },
      responses: { total: totals.total || 0, pending: totals.pending || 0, starred: totals.starred || 0, unread: totals.unread || 0, today: counts.get(today) || 0, week: trend.slice(-7).reduce((sum, day) => sum + day.count, 0), month: trend.reduce((sum, day) => sum + day.count, 0) },
      trend,
      recent,
      top
    });
  });
  return router;
}

export function systemRoutes({ db, storage, settings, audit, publicOrigin }) {
  const router = Router();
  router.get('/', (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const total = db.prepare('SELECT count(*) AS n FROM audit').get().n;
    res.json({
      forms: db.prepare('SELECT count(*) AS n FROM forms WHERE deleted_at IS NULL').get().n,
      trashedForms: db.prepare('SELECT count(*) AS n FROM forms WHERE deleted_at IS NOT NULL').get().n,
      responses: db.prepare('SELECT count(*) AS n FROM responses WHERE deleted_at IS NULL').get().n,
      trashedResponses: db.prepare('SELECT count(*) AS n FROM responses WHERE deleted_at IS NOT NULL').get().n,
      users: db.prepare('SELECT count(*) AS n FROM users').get().n,
      ...storage.usage(),
      version: appVersion,
      settings: { values: settings.values(), locked: settings.locked(), publicOrigin },
      node: process.version,
      uptime: Math.round(process.uptime()),
      events: { total, page, pageSize: 25, items: db.prepare('SELECT action, target, detail, actor, created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 25 OFFSET ?').all((page - 1) * 25) }
    });
  });
  router.put('/settings', (req, res) => {
    const values = settings.update(req.body);
    audit(req, 'settings', 'system', '');
    res.json({ values, locked: settings.locked(), publicOrigin });
  });
  return router;
}
