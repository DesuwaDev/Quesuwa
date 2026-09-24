import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { normalizeDefinition } from '../../shared/schema.js';
import { fail } from '../errors.js';
import { transaction } from '../db.js';

const hideSecrets = (form, role) => role === 'viewer' && form?.settings ? { ...form, settings: { ...form.settings, webhookSecret: '' } } : form;

export function formRoutes({ db, forms, storage, audit, auth, webhooks, tickets }) {
  const router = Router();
  const write = auth.allow('forms.write');
  const slugTaken = (slug, exceptId = '') => Boolean(db.prepare('SELECT id FROM forms WHERE slug=? AND id<>?').get(slug, exceptId));
  const uniqueSlug = base => {
    let slug = base.slice(0, 56);
    while (slugTaken(slug)) slug = `${base.slice(0, 48)}-${randomUUID().slice(0, 6)}`;
    return slug;
  };

  function insert(req, definition) {
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO forms(id,slug,state,version,definition,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,1,?,?,?,?,?)')
      .run(id, definition.slug, definition.state, JSON.stringify(definition), now, now, req.user.username, req.user.username);
    return forms.get(id);
  }

  router.get('/', (req, res) => res.json(forms.list(req.query.trash === 'true').map(form => hideSecrets(form, req.user.role))));

  router.get('/:id', (req, res) => res.json(hideSecrets(forms.require(req.params.id), req.user.role)));

  router.post('/', write, (req, res) => {
    const body = req.body || {};
    // Imports and templates may omit a slug; generate a unique one.
    const definition = normalizeDefinition({ ...body, slug: body.slug || uniqueSlug(`survey-${randomUUID().slice(0, 8)}`) });
    if (slugTaken(definition.slug)) throw fail(409, 'errors.slugTaken');
    const form = insert(req, definition);
    audit(req, 'createForm', form.id, form.title);
    res.status(201).json(form);
  });

  router.put('/:id', write, (req, res) => {
    const current = forms.require(req.params.id);
    if (current.deletedAt) throw fail(404, 'errors.formNotFound');
    const definition = normalizeDefinition(req.body);
    if (slugTaken(definition.slug, current.id)) throw fail(409, 'errors.slugTaken');
    const result = db.prepare('UPDATE forms SET slug=?, state=?, version=version+1, definition=?, updated_at=?, updated_by=? WHERE id=? AND version=?')
      .run(definition.slug, definition.state, JSON.stringify(definition), new Date().toISOString(), req.user.username, current.id, req.body.version ?? -1);
    if (!result.changes) throw fail(409, 'errors.editConflict');
    audit(req, current.state !== definition.state ? `state:${definition.state}` : 'updateForm', current.id, definition.title);
    res.json(forms.get(current.id));
  });

  // Quick state switch from the list without opening the editor.
  router.post('/:id/state', write, (req, res) => {
    const current = forms.require(req.params.id);
    if (current.deletedAt) throw fail(404, 'errors.formNotFound');
    const definition = normalizeDefinition({ ...current, state: req.body?.state });
    db.prepare('UPDATE forms SET state=?, version=version+1, definition=?, updated_at=?, updated_by=? WHERE id=?')
      .run(definition.state, JSON.stringify(definition), new Date().toISOString(), req.user.username, current.id);
    audit(req, `state:${definition.state}`, current.id, current.title);
    res.json(forms.get(current.id));
  });

  router.post('/:id/duplicate', write, (req, res) => {
    const source = forms.require(req.params.id);
    const definition = normalizeDefinition({ ...source, state: 'draft', slug: uniqueSlug(`${source.slug.slice(0, 40)}-copy`) });
    const form = insert(req, definition);
    audit(req, 'duplicate', form.id, form.title);
    res.status(201).json(form);
  });

  router.delete('/:id', write, (req, res) => {
    const form = forms.require(req.params.id);
    if (req.query.permanent === 'true') {
      if (!auth.can(req, 'forms.purge')) throw fail(403, 'errors.forbidden');
      if (!form.deletedAt || req.body?.confirmation !== form.title) throw fail(400, 'errors.deleteConfirm');
      transaction(db, () => {
        storage.queue(db.prepare('SELECT attachments FROM responses WHERE form_id=?').all(form.id));
        tickets.removeFor(db.prepare('SELECT id FROM responses WHERE form_id=?').all(form.id).map(row => row.id));
        db.prepare('DELETE FROM responses WHERE form_id=?').run(form.id);
        db.prepare('DELETE FROM webhook_deliveries WHERE form_id=?').run(form.id);
        db.prepare('DELETE FROM forms WHERE id=?').run(form.id);
      });
      storage.cleanup();
      audit(req, 'purgeForm', form.id, form.title);
    } else {
      const now = new Date().toISOString();
      db.prepare('UPDATE forms SET deleted_at=?, version=version+1, updated_at=?, updated_by=? WHERE id=? AND deleted_at IS NULL').run(now, now, req.user.username, form.id);
      audit(req, 'trashForm', form.id, form.title);
    }
    res.json({ ok: true });
  });

  router.post('/:id/restore', write, (req, res) => {
    const form = forms.require(req.params.id);
    if (!form.deletedAt) throw fail(400, 'errors.badRequest');
    const definition = normalizeDefinition({ ...form, state: 'draft', slug: slugTaken(form.slug, form.id) ? uniqueSlug(form.slug) : form.slug });
    db.prepare('UPDATE forms SET deleted_at=NULL, slug=?, state=?, definition=?, version=version+1, updated_at=?, updated_by=? WHERE id=?')
      .run(definition.slug, definition.state, JSON.stringify(definition), new Date().toISOString(), req.user.username, form.id);
    audit(req, 'restoreForm', form.id, form.title);
    res.json(forms.get(form.id));
  });

  router.get('/:id/definition', (req, res) => {
    const form = forms.require(req.params.id);
    const { slug: _slug, state: _state, ...definition } = normalizeDefinition({ ...form, state: 'draft' });
    definition.settings = { ...definition.settings, webhookSecret: '' };
    res.attachment('questionnaire.json').json({ format: 'quesuwa.form', formatVersion: 2, ...definition });
  });

  router.get('/:id/webhook', write, (req, res) => {
    forms.require(req.params.id);
    res.json(webhooks.deliveries(req.params.id));
  });

  router.post('/:id/webhook/test', write, async (req, res) => {
    const form = forms.require(req.params.id);
    if (!form.settings?.webhookUrl) throw fail(400, 'errors.webhookUrl');
    const result = await webhooks.send(form, 'ping', { message: 'ping' });
    audit(req, 'webhookTest', form.id, form.title);
    res.json(result);
  });

  return router;
}
