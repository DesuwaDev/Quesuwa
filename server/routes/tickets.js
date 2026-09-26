import { Router } from 'express';
import { answerable, normalizeSettings } from '../../shared/schema.js';
import { fail } from '../errors.js';

// Respondent view of a ticket, authorised by the private key from the follow-up link.
export function ticketRoutes({ db, forms, tickets, webhooks, notifier, limiter }) {
  const router = Router();
  const key = req => req.get('x-ticket-key');

  function view(row) {
    const snapshot = JSON.parse(row.snapshot);
    const answers = JSON.parse(row.answers);
    const attachments = JSON.parse(row.attachments);
    const form = forms.get(row.form_id);
    const open = Boolean(form && !form.deletedAt && normalizeSettings(form.settings).ticketMode);
    return {
      id: row.id,
      formTitle: form?.title || snapshot.title,
      createdAt: row.created_at,
      status: row.status,
      canReply: open,
      fields: snapshot.fields.filter(answerable).map(field => ({
        id: field.id, type: field.type, label: field.label, rows: field.rows, options: field.options, allowOther: field.allowOther,
        value: field.type === 'file' ? attachments.filter(a => a.fieldId === field.id).map(({ name, size }) => ({ name, size })) : answers[field.id] ?? null
      })),
      messages: tickets.messages(row.id).map(({ id, author, authorName, body, createdAt }) => ({ id, author, authorName: author === 'staff' ? authorName : '', body, createdAt }))
    };
  }

  router.get('/:id', limiter(15 * 60_000, 300), (req, res) => {
    res.json(view(tickets.open(req.params.id, key(req))));
  });

  router.post('/:id/messages', limiter(60 * 60_000, 30), (req, res) => {
    const row = tickets.open(req.params.id, key(req));
    if (!view(row).canReply) throw fail(410, 'errors.ticketClosed');
    const message = tickets.add(row.id, { author: 'respondent', body: req.body?.body });
    if (['resolved', 'needsInfo'].includes(row.status)) tickets.add(row.id, { author: 'system', body: 'status:pending' });
    // A reply to a resolved or "needs info" ticket puts it back in the queue.
    db.prepare("UPDATE responses SET unread=1, last_activity_at=?, status=CASE WHEN status IN ('resolved','needsInfo') THEN 'pending' ELSE status END WHERE id=?").run(message.createdAt, row.id);
    const form = forms.get(row.form_id);
    if (form) {
      webhooks.send(form, 'message.created', { responseId: row.id, message: { id: message.id, body: message.body, createdAt: message.createdAt } }).catch(error => console.error(error));
      notifier.ticketReplied({ form, row, message, origin: `${req.protocol}://${req.get('host')}` });
    }
    res.status(201).json(view(db.prepare('SELECT * FROM responses WHERE id=?').get(row.id)));
  });
  return router;
}
