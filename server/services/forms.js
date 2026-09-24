import { normalizeSettings } from '../../shared/schema.js';
import { fail } from '../errors.js';

export function createFormStore(db) {
  const unpack = row => row && ({
    ...JSON.parse(row.definition),
    id: row.id,
    slug: row.slug,
    state: row.state,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    ...(row.response_count !== undefined ? { responseCount: row.response_count } : {}),
    ...(row.last_response_at !== undefined ? { lastResponseAt: row.last_response_at } : {})
  });

  const get = id => unpack(db.prepare('SELECT f.*, (SELECT COUNT(*) FROM responses r WHERE r.form_id=f.id AND r.deleted_at IS NULL) AS response_count FROM forms f WHERE f.id=?').get(id));
  const bySlug = slug => unpack(db.prepare('SELECT * FROM forms WHERE slug=?').get(slug));

  function require(id) {
    const form = get(id);
    if (!form) throw fail(404, 'errors.formNotFound');
    return form;
  }

  function list(trash) {
    return db.prepare(`SELECT f.*,
      (SELECT COUNT(*) FROM responses r WHERE r.form_id=f.id AND r.deleted_at IS NULL) AS response_count,
      (SELECT MAX(created_at) FROM responses r WHERE r.form_id=f.id AND r.deleted_at IS NULL) AS last_response_at
      FROM forms f WHERE f.deleted_at IS ${trash ? 'NOT NULL' : 'NULL'} ORDER BY f.updated_at DESC`).all().map(unpack);
  }

  // Responses in the trash still count toward the collection limit.
  const collected = formId => db.prepare('SELECT count(*) AS n FROM responses WHERE form_id=?').get(formId).n;

  function availability(form) {
    if (!form || form.deletedAt || form.state === 'draft') return { status: 404, code: 'errors.formUnavailable' };
    const settings = normalizeSettings(form.settings);
    const detail = settings.closedMessage ? { message: settings.closedMessage } : {};
    if (form.state !== 'published') return { status: 410, code: 'errors.formClosed', params: detail };
    const now = Date.now();
    if (settings.startsAt && now < Date.parse(settings.startsAt)) return { status: 410, code: 'errors.notStarted', params: { ...detail, startsAt: settings.startsAt } };
    if (settings.endsAt && now >= Date.parse(settings.endsAt)) return { status: 410, code: 'errors.outsideSchedule', params: detail };
    if (settings.responseLimit && collected(form.id) >= settings.responseLimit) return { status: 410, code: 'errors.responseLimit', params: detail };
    return null;
  }

  function assertOpen(form) {
    const problem = availability(form);
    if (problem) throw fail(problem.status, problem.code, problem.params);
  }

  // Strips administrator-only configuration before a definition reaches respondents.
  function publicView(form) {
    const settings = normalizeSettings(form.settings);
    return {
      id: form.id,
      slug: form.slug,
      title: form.title,
      description: form.description,
      version: form.version,
      fields: form.fields,
      settings: {
        showProgress: settings.showProgress,
        showNumbers: settings.showNumbers,
        saveProgress: settings.saveProgress,
        onePerDevice: settings.onePerDevice,
        submitLabel: settings.submitLabel,
        consentText: settings.consentText,
        accent: settings.accent,
        endsAt: settings.endsAt,
        protected: Boolean(settings.accessCode)
      }
    };
  }

  return { unpack, get, bySlug, require, list, availability, assertOpen, publicView, collected };
}
