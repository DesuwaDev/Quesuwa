import { Router } from 'express';
import { answerable, normalizeSettings } from '../../shared/schema.js';
import { fail } from '../errors.js';
import { LIMITS } from '../../shared/constants.js';
import { messageBody, storeMessageFiles } from '../lib/message-files.js';

// Respondent view of a ticket, authorised by the private key from the follow-up link.
export function ticketRoutes({ db, forms, storage, tickets, webhooks, notifier, limiter }) {
  const router = Router();
  const key = req => req.get('x-ticket-key');

  function view(row) {
    const snapshot = JSON.parse(row.snapshot);
    const answers = JSON.parse(row.answers);
    const attachments = JSON.parse(row.attachments);
    const form = forms.get(row.form_id);
    const settings = form ? normalizeSettings(form.settings) : null;
    const open = Boolean(form && !form.deletedAt && settings.ticketMode);
    const canReply = open && row.status !== 'closed';
    return {
      id: row.id,
      formTitle: form?.title || snapshot.title,
      createdAt: row.created_at,
      status: row.status,
      rev: tickets.revision(row.id),
      canReply,
      // Respondents may attach files unless the questionnaire or this conversation turns it off.
      files: { allowed: canReply && settings.ticketFiles && !row.files_disabled, max: LIMITS.messageFiles, maxMB: LIMITS.fileMB },
      closed: row.status === 'closed',
      formSlug: form && form.state === 'published' && !form.deletedAt ? form.slug : '',
      fields: snapshot.fields.filter(answerable).map(field => ({
        id: field.id, type: field.type, label: field.label, rows: field.rows, options: field.options, allowOther: field.allowOther,
        value: field.type === 'file' ? attachments.filter(a => a.fieldId === field.id).map(({ name, size }) => ({ name, size })) : answers[field.id] ?? null
      })),
      messages: tickets.publicMessages(row.id)
    };
  }

  router.get('/:id', limiter(15 * 60_000, 300), (req, res) => {
    res.json(view(tickets.open(req.params.id, key(req))));
  });

  // Attachments are fetched with the key in a header, never in the URL.
  router.get('/:id/files/:fileId', limiter(15 * 60_000, 600), (req, res) => {
    const row = tickets.open(req.params.id, key(req));
    const file = tickets.fileOf(row.id, req.params.fileId);
    if (!file) throw fail(404, 'errors.fileNotFound');
    storage.send(res, file, req.query.inline === '1');
  });

  // Read receipts: ids of staff messages that were on screen while the page was visible.
  router.post('/:id/read', limiter(15 * 60_000, 600), (req, res) => {
    const row = tickets.open(req.params.id, key(req));
    res.json({ ok: true, marked: tickets.markRead(row.id, req.body?.ids) });
  });

  // Long poll: answers as soon as the conversation changes, or with 204 after a quiet period.
  router.get('/:id/wait', limiter(15 * 60_000, 600), (req, res) => {
    const row = tickets.open(req.params.id, key(req));
    tickets.wait(req, res, row.id, () => {
      const current = view(tickets.open(row.id, key(req)));
      return { rev: current.rev, body: current };
    });
  });

  // The key is checked before any upload is read.
  const authorised = (req, _res, next) => { tickets.open(req.params.id, key(req)); next(); };
  router.post('/:id/messages', limiter(60 * 60_000, 30), authorised, messageBody, async (req, res) => {
    const row = tickets.open(req.params.id, key(req));
    // Already stored by an earlier attempt whose answer was lost: report the current state.
    if (tickets.recall(row.id, req.get('idempotency-key'))) return res.status(201).json(view(row));
    const current = view(row);
    if (!current.canReply) throw fail(410, current.closed ? 'errors.ticketLocked' : 'errors.ticketClosed');
    if (req.files?.length && !current.files.allowed) throw fail(403, 'errors.ticketFilesOff');
    const { attachments, rollback } = await storeMessageFiles(storage, req.files);
    let message;
    try { message = tickets.add(row.id, { author: 'respondent', body: req.body?.body, attachments }); }
    catch (error) { rollback(); throw error; }
    tickets.remember(row.id, req.get('idempotency-key'), message.id);
    if (['resolved', 'needsInfo'].includes(row.status)) tickets.add(row.id, { author: 'system', body: 'status:pending' });
    // A reply to a resolved or "needs info" ticket puts it back in the queue.
    db.prepare("UPDATE responses SET unread=1, last_activity_at=?, status=CASE WHEN status IN ('resolved','needsInfo') THEN 'pending' ELSE status END WHERE id=?").run(message.createdAt, row.id);
    const form = forms.get(row.form_id);
    if (form) {
      webhooks.send(form, 'message.created', { responseId: row.id, message: { id: message.id, body: message.body, createdAt: message.createdAt, attachments: attachments.map(({ name, mime, size }) => ({ name, mime, size })) } }).catch(error => console.error(error));
      notifier.ticketReplied({ form, row, message, origin: `${req.protocol}://${req.get('host')}` });
    }
    res.status(201).json(view(db.prepare('SELECT * FROM responses WHERE id=?').get(row.id)));
  });
  return router;
}
