import { Router } from 'express';
import multer from 'multer';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { normalizeSettings, answerable } from '../../shared/schema.js';
import { visibleFields, checkAnswer } from '../../shared/answers.js';
import { LIMITS } from '../../shared/constants.js';
import { normalizeLocale } from '../../i18n/core.js';
import { fail } from '../errors.js';
import { t } from '../i18n.js';

const digest = value => createHash('sha256').update(String(value)).digest();
const codeMatches = (expected, given) => typeof given === 'string' && given.length <= 64 && timingSafeEqual(digest(expected), digest(given));
const deviceCookie = formId => 'quesuwa_done_' + formId.replaceAll('-', '').slice(0, 16);

export function publicRoutes({ db, forms, storage, webhooks, tickets, notifier, limiter, secureCookie }) {
  const router = Router();
  const alreadySubmitted = (req, form) => normalizeSettings(form.settings).onePerDevice && new RegExp(`(?:^|;\\s*)${deviceCookie(form.id)}=1(?:;|$)`).test(req.headers.cookie || '');

  function access(req, form) {
    const settings = normalizeSettings(form.settings);
    if (!settings.accessCode) return;
    if (!codeMatches(settings.accessCode, req.body?.accessCode)) throw fail(403, 'errors.accessCode', { protected: true, title: form.title });
  }

  function load(slug) {
    const form = forms.bySlug(slug);
    forms.assertOpen(form);
    return form;
  }

  router.get('/', (_req, res) => {
    const rows = db.prepare("SELECT * FROM forms WHERE state='published' AND deleted_at IS NULL ORDER BY updated_at DESC").all().map(forms.unpack);
    res.json(rows.filter(form => form.settings?.listed && !forms.availability(form)).map(form => {
      const settings = normalizeSettings(form.settings);
      return { id: form.id, slug: form.slug, title: form.title, description: form.description, questionCount: form.fields.filter(answerable).length, endsAt: settings.endsAt, protected: Boolean(settings.accessCode), accent: settings.accent };
    }));
  });

  router.get('/:slug', (req, res) => {
    const form = load(req.params.slug);
    if (alreadySubmitted(req, form)) throw fail(409, 'errors.alreadySubmitted');
    const settings = normalizeSettings(form.settings);
    // Protected forms only reveal their questions through the rate-limited access endpoint.
    if (settings.accessCode) return res.json({ locked: true, id: form.id, slug: form.slug, title: form.title, settings: { accent: settings.accent } });
    res.json(forms.publicView(form));
  });

  // Separate endpoint so wrong access codes are rate limited.
  router.post('/:slug/access', limiter(15 * 60_000, 30), (req, res) => {
    const form = load(req.params.slug);
    access(req, form);
    res.json(forms.publicView(form));
  });

  let activeUploads = 0;
  const uploadSlots = (_req, res, next) => {
    if (activeUploads >= 4) return next(fail(503, 'errors.uploadBusy'));
    activeUploads++;
    let released = false;
    const release = () => { if (!released) { released = true; activeUploads--; } };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.fileMB * 1024 * 1024, files: LIMITS.fileFields * LIMITS.filesPerField, fields: 10, fieldSize: 2 * 1024 * 1024, parts: 20 } }).any();

  router.post('/:slug/responses', limiter(60 * 60_000, 20), uploadSlots, (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(fail(415, 'errors.multipart'));
    const form = forms.bySlug(req.params.slug);
    if (!form || form.state !== 'published' || form.deletedAt) return next(fail(404, 'errors.formNotOpen'));
    forms.assertOpen(form);
    if (alreadySubmitted(req, form)) return next(fail(409, 'errors.alreadySubmitted'));
    req.questionnaire = form;
    upload(req, res, next);
  }, async (req, res) => {
    const form = req.questionnaire;
    if (Number(req.body.version) !== form.version) throw fail(409, 'errors.versionConflict');
    if (req.body.website) throw fail(400, 'errors.verification');
    access(req, form);
    let incoming;
    try { incoming = JSON.parse(req.body.answers); } catch { throw fail(400, 'errors.answersInvalid'); }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw fail(400, 'errors.answersInvalid');
    const settings = normalizeSettings(form.settings);
    if (settings.consentText && req.body.consent !== 'true') throw fail(400, 'errors.consent');
    const files = req.files || [];
    // File presence drives conditions, so count real uploads instead of trusting the client.
    const probe = { ...incoming };
    for (const field of form.fields) if (field.type === 'file') probe[field.id] = files.filter(file => file.fieldname === field.id).length;
    const active = visibleFields(form.fields, probe);
    const answers = Object.create(null);
    for (const file of files) {
      if (!active.some(field => field.id === file.fieldname && field.type === 'file')) throw fail(400, 'errors.fileField');
    }
    for (const field of active) {
      if (!answerable(field)) continue;
      if (field.type === 'file') {
        const count = files.filter(file => file.fieldname === field.id).length;
        if (count > (field.maxFiles || LIMITS.filesPerField)) throw fail(400, 'errors.customFileLimit', { label: field.label, fieldId: field.id });
        if (field.required && !count) throw fail(400, 'errors.fileRequired', { label: field.label, fieldId: field.id });
        continue;
      }
      const { value, error, params } = checkAnswer(field, incoming[field.id]);
      if (error) throw fail(400, error, { ...params, label: field.label, fieldId: field.id });
      if (value !== '' && !(Array.isArray(value) && !value.length)) answers[field.id] = value;
    }
    const attachments = [];
    for (const file of files) attachments.push(await storage.inspect(file, active.find(field => field.id === file.fieldname)));
    // File detection is asynchronous: confirm the form is unchanged before writing.
    const latest = forms.get(form.id);
    forms.assertOpen(latest);
    if (latest.version !== form.version) throw fail(409, 'errors.formChanged');
    storage.ensureCapacity(files.reduce((sum, file) => sum + file.size, 0));
    const duration = Number.parseInt(req.body.duration, 10);
    const response = { id: randomUUID(), createdAt: new Date().toISOString(), answers, attachments };
    const ticket = settings.ticketMode ? tickets.issueKey(response.id) : null;
    const rollback = storage.write(attachments, files.map(file => file.buffer));
    try {
      db.prepare('INSERT INTO responses (id, form_id, snapshot, answers, attachments, created_at, status, duration_ms, locale, access_hash, last_activity_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        response.id, form.id, JSON.stringify({ id: form.id, slug: form.slug, title: form.title, version: form.version, fields: form.fields }), JSON.stringify(answers), JSON.stringify(attachments), response.createdAt, 'pending',
        Number.isInteger(duration) && duration > 0 && duration < 7 * 24 * 3600_000 ? duration : null,
        normalizeLocale(req.body.locale) || '', ticket?.hash ?? null, response.createdAt);
    } catch (error) { rollback(); throw error; }
    if (settings.onePerDevice) res.cookie(deviceCookie(form.id), '1', { httpOnly: true, sameSite: 'lax', secure: secureCookie(req), path: '/api/forms', maxAge: 365 * 24 * 3600_000 });
    webhooks.responseCreated(form, response);
    notifier.responseCreated({ form, row: db.prepare('SELECT * FROM responses WHERE id=?').get(response.id), origin: `${req.protocol}://${req.get('host')}` });
    res.status(201).json({ id: response.id, thanks: form.thanks || t('common.thanks'), thanksKey: form.thanks ? null : 'common.thanks', ...(ticket ? { ticket: { id: response.id, key: ticket.key } } : {}) });
  });

  return router;
}
