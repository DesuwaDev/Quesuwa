import { Router } from 'express';
import { statuses } from '../../shared/constants.js';
import { fail } from '../errors.js';
import { transaction } from '../db.js';
import { t } from '../i18n.js';
import { parseResponse, responseFilter } from '../services/responses.js';
import { computeStatistics, parseOffset } from '../services/statistics.js';
import { streamCsv, streamJson, zipEntries } from '../services/exports.js';
import { writeZip, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES } from '../lib/zip.js';
import { messageBody, storeMessageFiles } from '../lib/message-files.js';
import { normalizeSettings } from '../../shared/schema.js';

const exportName = (form, extension) => `${form.slug}-${new Date().toISOString().slice(0, 10)}.${extension}`;

export function responseRoutes({ db, forms, storage, audit, auth, tickets, notifier }) {
  const router = Router();
  const write = auth.allow('responses.write');
  const findResponse = id => {
    const row = db.prepare('SELECT * FROM responses WHERE id=?').get(id);
    if (!row) throw fail(404, 'errors.responseNotFound');
    return row;
  };
  const origin = req => `${req.protocol}://${req.get('host')}`;
  // A conversation exists when the respondent can read it (ticket) or be emailed.
  const conversable = (form, row) => Boolean(row.access_hash) || Boolean(form && notifier.recipientFor(form, row));
  // Status changes are kept in the conversation as a progress timeline.
  function recordStatus(form, row, status) {
    if (status === row.status || !conversable(form, row)) return null;
    return tickets.add(row.id, { author: 'system', body: 'status:' + status });
  }

  router.get('/forms/:id/responses', (req, res) => {
    forms.require(req.params.id);
    const pageSize = [20, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 20;
    const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
    const filter = responseFilter(req.params.id, req.query);
    const order = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
    const total = db.prepare(`SELECT count(*) AS n FROM responses WHERE ${filter.where}`).get(...filter.params).n;
    const sortColumn = req.query.sort === 'activity' ? 'COALESCE(last_activity_at, created_at) DESC' : `created_at ${order}`;
    const items = db.prepare(`SELECT *, (SELECT count(*) FROM messages m WHERE m.response_id=responses.id) AS message_count FROM responses WHERE ${filter.where} ORDER BY ${sortColumn}, id ${order} LIMIT ? OFFSET ?`).all(...filter.params, pageSize, (page - 1) * pageSize).map(parseResponse);
    res.json({ items, total, page, pageSize });
  });

  router.get('/responses/:id', (req, res) => {
    const response = parseResponse(findResponse(req.params.id));
    const row = findResponse(req.params.id);
    const form = forms.get(response.formId);
    const contact = form ? notifier.recipientFor(form, row) : '';
    const followUp = form ? notifier.followUpLink(origin(req), row, form) : '';
    res.json({
      ...response, formTitle: form?.title || response.snapshot.title, contactEmail: contact, followUpUrl: followUp, conversation: Boolean(form) && conversable(form, row),
      messages: tickets.messages(response.id), rev: tickets.revision(response.id), ...fileState(form, row)
    });
  });

  // Whether respondents may attach files: the questionnaire setting and this conversation's switch.
  const fileState = (form, row) => ({ filesAllowed: Boolean(form) && normalizeSettings(form.settings).ticketFiles, filesDisabled: Boolean(row.files_disabled) });

  // What an open conversation needs to stay current; the admin view long-polls for it.
  const liveState = row => ({ rev: tickets.revision(row.id), status: row.status, unread: Boolean(row.unread), lastActivityAt: row.last_activity_at || row.created_at, messages: tickets.messages(row.id), filesDisabled: Boolean(row.files_disabled) });
  router.get('/responses/:id/wait', (req, res) => {
    const row = findResponse(req.params.id);
    tickets.wait(req, res, row.id, () => {
      const state = liveState(findResponse(row.id));
      return { rev: state.rev, body: state };
    });
  });

  router.post('/responses/:id/read', (req, res) => {
    const id = findResponse(req.params.id).id;
    db.prepare('UPDATE responses SET unread=0 WHERE id=?').run(id);
    tickets.changed(id);
    res.json({ ok: true });
  });

  // Conversation attachments, including those of retracted messages, for staff.
  router.get('/responses/:id/conversation-files/:fileId', (req, res) => {
    const file = tickets.fileOf(findResponse(req.params.id).id, req.params.fileId, { staff: true });
    if (!file) throw fail(404, 'errors.fileNotFound');
    storage.send(res, file, req.query.inline === '1');
  });

  // Staff may correct or retract any message; the respondent sees only the result, with no marker.
  router.patch('/responses/:id/messages/:messageId', write, (req, res) => {
    const row = findResponse(req.params.id);
    const message = tickets.edit(row.id, req.params.messageId, req.body?.body, req.user.displayName || req.user.username);
    audit(req, 'messageEdited', row.id, message.author);
    res.json({ message });
  });
  router.delete('/responses/:id/messages/:messageId', write, (req, res) => {
    const row = findResponse(req.params.id);
    const message = tickets.retract(row.id, req.params.messageId, req.user.displayName || req.user.username);
    audit(req, 'messageRetracted', row.id, message.author);
    res.json({ message });
  });
  router.post('/responses/:id/messages/:messageId/restore', write, (req, res) => {
    const row = findResponse(req.params.id);
    const message = tickets.retract(row.id, req.params.messageId, '', false);
    audit(req, 'messageRestored', row.id, message.author);
    res.json({ message });
  });

  // Staff reply, optionally changing the status and emailing the respondent in the same step.
  // Accepts JSON, or multipart when files are attached.
  router.post('/responses/:id/messages', write, messageBody, async (req, res) => {
    const row = findResponse(req.params.id);
    const form = forms.get(row.form_id);
    if (row.deleted_at || !form || !conversable(form, row)) throw fail(404, 'errors.ticketNotFound');
    const repeated = tickets.recall(row.id, req.get('idempotency-key'));
    if (repeated) return res.json({ message: tickets.find(row.id, repeated), event: null, delivery: null, response: parseResponse(row), repeated: true });
    const status = req.body?.status || undefined;
    if (status !== undefined && !statuses.includes(status)) throw fail(400, 'errors.statusInvalid');
    const email = (req.body?.email === true || req.body?.email === 'true') && Boolean(notifier.recipientFor(form, row)) && notifier.status().mail;
    const { attachments, rollback } = await storeMessageFiles(storage, req.files);
    // With batching on, the email waits until the conversation pauses and covers every message since.
    const later = email && notifier.batching();
    let message;
    try { message = tickets.add(row.id, { author: 'staff', userId: req.user.id, authorName: req.user.displayName || req.user.username, body: req.body?.body, delivery: later ? 'queued' : email ? 'pending' : '', attachments }); }
    catch (error) { rollback(); throw error; }
    tickets.remember(row.id, req.get('idempotency-key'), message.id);
    const event = status ? recordStatus(form, row, status) : null;
    db.prepare('UPDATE responses SET unread=0, last_activity_at=?, status=COALESCE(?, status) WHERE id=?').run(message.createdAt, status ?? null, row.id);
    let delivery = null;
    if (later) delivery = { ok: true, queued: true, dueAt: notifier.queueConversation(row.id, 'respondent', message.createdAt, origin(req)) };
    else if (email) {
      delivery = await notifier.emailRespondent({ form, row: findResponse(row.id), origin: origin(req), kind: 'message', message, status: status ?? row.status });
      message.delivery = delivery.ok ? 'sent' : 'failed';
      tickets.setDelivery(message.id, message.delivery);
    }
    res.status(201).json({ message, event, delivery, response: parseResponse(findResponse(row.id)) });
  });

  router.post('/responses/:id/messages/:messageId/resend', write, async (req, res) => {
    const row = findResponse(req.params.id);
    const form = forms.get(row.form_id);
    const message = tickets.find(row.id, req.params.messageId);
    if (!form || !message || message.author === 'respondent') throw fail(404, 'errors.ticketNotFound');
    const status = message.author === 'system' ? message.body.replace(/^status:/, '') : row.status;
    const delivery = await notifier.emailRespondent({ form, row, origin: origin(req), kind: message.author === 'system' ? 'status' : 'message', message, status });
    tickets.setDelivery(message.id, delivery.ok ? 'sent' : 'failed');
    res.json({ delivery, message: tickets.find(row.id, message.id) });
  });

  router.patch('/responses/:id', write, async (req, res) => {
    const row = findResponse(req.params.id);
    if (row.deleted_at) throw fail(404, 'errors.responseNotFound');
    const body = req.body || {};
    const status = body.status ?? row.status;
    const note = body.note ?? row.note;
    const starred = body.starred ?? Boolean(row.starred);
    if (body.filesDisabled !== undefined) {
      if (typeof body.filesDisabled !== 'boolean') throw fail(400, 'errors.badRequest');
      db.prepare('UPDATE responses SET files_disabled=? WHERE id=?').run(body.filesDisabled ? 1 : 0, row.id);
      tickets.changed(row.id);
    }
    if (!statuses.includes(status)) throw fail(400, 'errors.statusInvalid');
    if (typeof note !== 'string' || note.length > 10000) throw fail(400, 'errors.noteInvalid');
    if (typeof starred !== 'boolean') throw fail(400, 'errors.badRequest');
    const form = forms.get(row.form_id);
    const event = form ? recordStatus(form, row, status) : null;
    db.prepare('UPDATE responses SET status=?, note=?, starred=?, last_activity_at=COALESCE(?, last_activity_at) WHERE id=?').run(status, note.trim(), starred ? 1 : 0, event?.createdAt ?? null, row.id);
    let delivery = null;
    if (event && body.notify === true && notifier.status().mail && notifier.recipientFor(form, row) && notifier.batching()) {
      tickets.setDelivery(event.id, event.delivery = 'queued');
      delivery = { ok: true, queued: true, dueAt: notifier.queueConversation(row.id, 'respondent', event.createdAt, origin(req)) };
    } else if (event && body.notify === true && notifier.status().mail && notifier.recipientFor(form, row)) {
      delivery = await notifier.emailRespondent({ form, row: findResponse(row.id), origin: origin(req), kind: 'status', status });
      event.delivery = delivery.ok ? 'sent' : 'failed';
      tickets.setDelivery(event.id, event.delivery);
    }
    const updated = findResponse(row.id);
    res.json({ ...parseResponse(updated), filesDisabled: Boolean(updated.files_disabled), event, delivery });
  });

  router.post('/forms/:id/responses/batch', write, (req, res) => {
    const form = forms.require(req.params.id);
    const { ids, action, status } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || id.length > 64)) throw fail(400, 'errors.badRequest');
    if (!['status', 'star', 'unstar', 'trash', 'restore', 'purge'].includes(action) || (action === 'status' && !statuses.includes(status))) throw fail(400, 'errors.badRequest');
    if (action === 'purge' && !auth.can(req, 'responses.purge')) throw fail(403, 'errors.forbidden');
    const rows = ids.map(id => db.prepare('SELECT * FROM responses WHERE id=? AND form_id=?').get(id, form.id));
    if (rows.some(row => !row)) throw fail(404, 'errors.responseNotFound');
    if (action === 'purge' && (rows.some(row => !row.deleted_at) || req.body.confirmation !== form.title)) throw fail(400, 'errors.deleteConfirm');
    const now = new Date().toISOString();
    transaction(db, () => {
      for (const row of rows) {
        if (action === 'status') { recordStatus(form, row, status); db.prepare('UPDATE responses SET status=? WHERE id=?').run(status, row.id); }
        if (action === 'star' || action === 'unstar') db.prepare('UPDATE responses SET starred=? WHERE id=?').run(action === 'star' ? 1 : 0, row.id);
        if (action === 'trash') db.prepare('UPDATE responses SET deleted_at=? WHERE id=? AND deleted_at IS NULL').run(now, row.id);
        if (action === 'restore') db.prepare('UPDATE responses SET deleted_at=NULL WHERE id=?').run(row.id);
        if (action === 'purge') { storage.queue([row]); tickets.removeFor([row.id]); db.prepare('DELETE FROM responses WHERE id=?').run(row.id); }
      }
    });
    storage.cleanup();
    audit(req, action === 'status' ? `responses:${status}` : `responses:${action}`, form.id, t('audit.responseCount', { count: rows.length, title: form.title }));
    res.json({ ok: true, count: rows.length });
  });

  router.get('/responses/:id/files/:fileId', (req, res) => {
    const row = findResponse(req.params.id);
    const file = JSON.parse(row.attachments).find(a => a.id === req.params.fileId);
    if (!file) throw fail(404, 'errors.fileNotFound');
    res.set('X-Content-Type-Options', 'nosniff');
    // Only raster images are rendered inline; everything else is a download.
    if (req.query.inline === '1' && /^image\/(png|jpeg|webp|gif)$/.test(file.mime)) {
      res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.set('Cache-Control', 'private, max-age=300');
      return res.type(file.mime).sendFile(storage.filePath(file.id), error => { if (error && !res.headersSent) res.status(404).end(); });
    }
    res.set('Content-Type', file.mime);
    res.download(storage.filePath(file.id), file.name, error => { if (error && !res.headersSent) res.status(404).end(); });
  });

  router.get('/forms/:id/statistics', (req, res) => {
    const form = forms.require(req.params.id);
    res.json(computeStatistics(db, form, responseFilter(form.id, { ...req.query, trash: 'false' }), parseOffset(req.query.tz)));
  });

  router.get('/forms/:id/export', (req, res) => {
    const form = forms.require(req.params.id);
    const filter = responseFilter(form.id, { ...req.query, trash: 'false' });
    const format = ['csv', 'long', 'json'].includes(req.query.format) ? req.query.format : 'csv';
    audit(req, 'export', form.id, form.title);
    if (format === 'json') {
      res.type('application/json; charset=utf-8').attachment(exportName(form, 'json'));
      return streamJson(db, res, form, filter);
    }
    res.type('text/csv; charset=utf-8').attachment(exportName(form, 'csv'));
    streamCsv(db, res, form, filter, format === 'long');
  });

  router.get('/forms/:id/attachments', async (req, res) => {
    const form = forms.require(req.params.id);
    const { entries, bytes } = zipEntries(db, responseFilter(form.id, { ...req.query, trash: 'false' }), storage.filePath);
    if (!entries.length) throw fail(404, 'errors.noAttachments');
    if (bytes > ZIP_MAX_BYTES || entries.length > ZIP_MAX_ENTRIES) throw fail(413, 'errors.zipTooLarge');
    audit(req, 'exportFiles', form.id, form.title);
    res.type('application/zip').attachment(exportName(form, 'zip'));
    try { await writeZip(res, entries); res.end(); }
    catch (error) { if (!error.aborted) console.error(error); res.destroy(); }
  });

  return router;
}
