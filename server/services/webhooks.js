import { createHmac } from 'node:crypto';
import { answerable, normalizeSettings } from '../../shared/schema.js';

export function createWebhooks(db) {
  const record = db.prepare('INSERT INTO webhook_deliveries(form_id,created_at,event,status,ok,error,duration_ms) VALUES (?,?,?,?,?,?,?)');
  const prune = db.prepare('DELETE FROM webhook_deliveries WHERE form_id=? AND id NOT IN (SELECT id FROM webhook_deliveries WHERE form_id=? ORDER BY id DESC LIMIT 30)');

  async function send(form, event, data) {
    const settings = normalizeSettings(form.settings);
    if (!settings.webhookUrl) return null;
    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), form: { id: form.id, slug: form.slug, title: form.title }, data });
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Quesuwa-Webhook/1', 'X-Quesuwa-Event': event };
    if (settings.webhookSecret) headers['X-Quesuwa-Signature'] = 'sha256=' + createHmac('sha256', settings.webhookSecret).update(body).digest('hex');
    const started = Date.now();
    let status = 0, ok = false, error = '';
    try {
      const response = await fetch(settings.webhookUrl, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(8000) });
      status = response.status;
      ok = response.ok;
      await response.body?.cancel();
    } catch (reason) {
      error = String(reason?.name || reason?.message || reason).slice(0, 200);
    }
    try {
      record.run(form.id, new Date().toISOString(), event, status, ok ? 1 : 0, error, Date.now() - started);
      prune.run(form.id, form.id);
    } catch { /* The database may already be closed during shutdown. */ }
    return { status, ok, error };
  }

  function responseCreated(form, response) {
    const data = {
      id: response.id,
      createdAt: response.createdAt,
      answers: form.fields.filter(answerable).map(field => ({
        fieldId: field.id,
        type: field.type,
        label: field.label,
        value: field.type === 'file' ? response.attachments.filter(a => a.fieldId === field.id).map(({ name, mime, size }) => ({ name, mime, size })) : response.answers[field.id] ?? null
      }))
    };
    send(form, 'response.created', data).catch(error => console.error(error));
  }

  const deliveries = formId => db.prepare('SELECT created_at AS createdAt, event, status, ok, error, duration_ms AS durationMs FROM webhook_deliveries WHERE form_id=? ORDER BY id DESC LIMIT 30').all(formId).map(row => ({ ...row, ok: Boolean(row.ok) }));

  return { send, responseCreated, deliveries };
}
