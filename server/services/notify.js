import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { translate } from '../../i18n/core.js';
import { answerable, normalizeSettings, isHttpUrl } from '../../shared/schema.js';
import { formatAnswer } from '../../shared/answers.js';
import { statusKeys } from '../../shared/constants.js';
import { fail } from '../errors.js';
import { contactEmail } from './responses.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const smtpDefaults = { enabled: false, host: '', port: 465, security: 'tls', user: '', pass: '', fromName: '', fromAddress: '' };
const defaults = () => ({
  siteUrl: '',
  events: { newResponse: true, ticketReply: true },
  alertMail: { ...smtpDefaults, recipients: [] },
  telegram: { enabled: false, token: '', chatIds: [], apiBase: 'https://api.telegram.org' },
  mail: { ...smtpDefaults, replyTo: '' },
  digest: { enabled: false, hour: 9, onlyActive: true, toRecipients: false },
  appearance: { brandName: '', color: '#B0554D', logoUrl: '', signature: '', footer: '' },
  templates: []
});
// Retry schedule for queued notifications: 30 s, 2 min, 10 min, 1 h, then give up.
const BACKOFF = [30_000, 120_000, 600_000, 3_600_000];
const invalid = code => fail(400, code);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortId = id => String(id).slice(0, 8).toUpperCase();
const errorText = error => String(error?.response || error?.message || error || '').slice(0, 300);

function text(value, max, { required = false, code = 'errors.notifyInvalid', multiline = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) throw invalid(code);
  const result = (multiline ? value : value.replace(/[\r\n]+/g, ' ')).trim();
  if (required && !result) throw invalid(code);
  return result;
}
const bool = (value, fallback) => value === undefined ? fallback : value === true;
const email = (value, code = 'errors.notifyEmail') => {
  const result = text(value, 254, { code });
  if (result && !EMAIL.test(result)) throw invalid(code);
  return result;
};

function smtp(input, current, kind) {
  if (input === undefined) return current;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('errors.notifyInvalid');
  const next = { ...current };
  next.enabled = bool(input.enabled, current.enabled);
  next.host = text(input.host ?? current.host, 255);
  if (next.host && !/^[A-Za-z0-9.-]+$/.test(next.host)) throw invalid('errors.notifyHost');
  next.port = input.port === undefined ? current.port : Number(input.port);
  if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw invalid('errors.notifyPort');
  next.security = input.security ?? current.security;
  if (!['tls', 'starttls', 'none'].includes(next.security)) throw invalid('errors.notifyInvalid');
  next.user = text(input.user ?? current.user, 255);
  // Passwords are write-only: an empty value keeps the stored one.
  if (input.clearPass === true) next.pass = '';
  else if (typeof input.pass === 'string' && input.pass) next.pass = text(input.pass, 500);
  next.fromName = text(input.fromName ?? current.fromName, 80);
  next.fromAddress = email(input.fromAddress ?? current.fromAddress);
  if (kind === 'alert') {
    const list = input.recipients ?? current.recipients;
    if (!Array.isArray(list) || list.length > 20) throw invalid('errors.notifyEmail');
    next.recipients = [...new Set(list.map(item => email(item)).filter(Boolean))];
  } else next.replyTo = email(input.replyTo ?? current.replyTo);
  if (next.enabled && (!next.host || !next.fromAddress)) throw invalid('errors.notifyIncomplete');
  return next;
}

function telegram(input, current) {
  if (input === undefined) return current;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('errors.notifyInvalid');
  const next = { ...current };
  next.enabled = bool(input.enabled, current.enabled);
  if (input.clearToken === true) next.token = '';
  else if (typeof input.token === 'string' && input.token.trim()) {
    next.token = input.token.trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(next.token) || next.token.length > 200) throw invalid('errors.telegramToken');
  }
  const chats = input.chatIds ?? current.chatIds;
  if (!Array.isArray(chats) || chats.length > 10) throw invalid('errors.telegramChat');
  next.chatIds = [...new Set(chats.map(chat => text(String(chat), 40)).filter(Boolean))];
  if (next.chatIds.some(chat => !/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(chat))) throw invalid('errors.telegramChat');
  next.apiBase = text(input.apiBase ?? current.apiBase, 200).replace(/\/+$/, '') || 'https://api.telegram.org';
  if (!isHttpUrl(next.apiBase)) throw invalid('errors.notifyInvalid');
  if (next.enabled && (!next.token || !next.chatIds.length)) throw invalid('errors.notifyIncomplete');
  return next;
}

function templates(input, current) {
  if (input === undefined) return current;
  if (!Array.isArray(input) || input.length > 50) throw invalid('errors.templateInvalid');
  return input.map(item => {
    const body = typeof item?.body === 'string' ? item.body.trim() : '';
    if (!body || body.length > 5000) throw invalid('errors.templateInvalid');
    return {
      id: typeof item?.id === 'string' && /^[\w-]{1,64}$/.test(item.id) ? item.id : randomUUID(),
      title: text(item?.title, 60, { required: true, code: 'errors.templateInvalid' }),
      body
    };
  });
}

function digest(input, current) {
  if (input === undefined) return current;
  if (!input || typeof input !== 'object') throw invalid('errors.notifyInvalid');
  const hour = input.hour === undefined ? current.hour : Number(input.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw invalid('errors.notifyInvalid');
  return { enabled: bool(input.enabled, current.enabled), hour, onlyActive: bool(input.onlyActive, current.onlyActive), toRecipients: bool(input.toRecipients, current.toRecipients) };
}

export function appearanceOf(input, current = defaults().appearance) {
  if (input === undefined) return current;
  if (!input || typeof input !== 'object') throw invalid('errors.notifyInvalid');
  const color = input.color ?? current.color;
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw invalid('errors.appearanceColor');
  const logoUrl = text(input.logoUrl ?? current.logoUrl, 500);
  if (logoUrl && !/^https:\/\//i.test(logoUrl)) throw invalid('errors.appearanceLogo');
  return {
    brandName: text(input.brandName ?? current.brandName, 40),
    color,
    logoUrl,
    signature: text(input.signature ?? current.signature, 500, { multiline: true }),
    footer: text(input.footer ?? current.footer, 500, { multiline: true })
  };
}

export function createNotifier(db, { settings, tickets, publicOrigin = '' }) {
  const read = () => {
    const stored = db.prepare("SELECT value FROM settings WHERE key='notifications'").get();
    const base = defaults();
    if (!stored) return base;
    const value = JSON.parse(stored.value);
    const merged = { ...base, ...value };
    for (const key of ['events', 'alertMail', 'telegram', 'mail', 'digest', 'appearance']) merged[key] = { ...base[key], ...value[key] };
    return merged;
  };
  let config = read();
  const persist = () => db.prepare("INSERT INTO settings(key, value) VALUES ('notifications', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config));

  function masked() {
    const hide = profile => { const { pass, ...rest } = profile; return { ...rest, pass: '', hasPass: Boolean(pass) }; };
    const { token, ...tg } = config.telegram;
    return { ...config, alertMail: hide(config.alertMail), mail: hide(config.mail), telegram: { ...tg, token: '', hasToken: Boolean(token) } };
  }

  function update(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('errors.notifyInvalid');
    const next = { ...config };
    if (input.siteUrl !== undefined) {
      const url = text(input.siteUrl, 200);
      if (url && !isHttpUrl(url)) throw invalid('errors.siteUrl');
      next.siteUrl = url ? new URL(url).origin : '';
    }
    if (input.events !== undefined) next.events = { newResponse: bool(input.events?.newResponse, config.events.newResponse), ticketReply: bool(input.events?.ticketReply, config.events.ticketReply) };
    next.alertMail = smtp(input.alertMail, config.alertMail, 'alert');
    next.mail = smtp(input.mail, config.mail, 'mail');
    next.telegram = telegram(input.telegram, config.telegram);
    next.digest = digest(input.digest, config.digest);
    next.appearance = appearanceOf(input.appearance, config.appearance);
    next.templates = templates(input.templates, config.templates);
    config = next;
    persist();
    return masked();
  }

  // ---- Channels ----
  async function sendMail(profile, message) {
    const transport = nodemailer.createTransport({
      host: profile.host, port: profile.port, secure: profile.security === 'tls', requireTLS: profile.security === 'starttls', ignoreTLS: profile.security === 'none',
      auth: profile.user ? { user: profile.user, pass: profile.pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    try { await transport.sendMail({ from: { name: profile.fromName || config.appearance.brandName || 'Quesuwa', address: profile.fromAddress }, ...message }); }
    finally { transport.close(); }
  }

  async function sendTelegram(textBody) {
    const { apiBase, token, chatIds } = config.telegram;
    for (const chat of chatIds) {
      const response = await fetch(`${apiBase}/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ chat_id: chat, text: textBody, parse_mode: 'HTML', disable_web_page_preview: true })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.description || String(response.status));
      }
    }
  }

  // Payloads are stored complete so a queued message survives restarts;
  // credentials are read at send time, so fixing a password heals queued mail.
  const perform = payload => payload.kind === 'telegram' ? sendTelegram(payload.text) : sendMail(config[payload.profile], payload.message);

  // ---- Durable outbox ----
  const insert = db.prepare('INSERT INTO outbox(created_at, next_at, attempts, channel, event, target, payload, status, error, sent_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const prune = db.prepare("DELETE FROM outbox WHERE status<>'pending' AND id NOT IN (SELECT id FROM outbox ORDER BY id DESC LIMIT 1000)");
  const safe = task => { try { return task(); } catch { return null; } };
  let running = false, closed = false;

  function enqueue(channel, event, target, payload) {
    insert.run(new Date().toISOString(), Date.now(), 0, channel, event, String(target).slice(0, 300), JSON.stringify(payload), 'pending', '', null);
    kick();
  }

  async function work() {
    if (running || closed) return;
    running = true;
    try {
      for (let round = 0; round < 5; round++) {
        const due = safe(() => db.prepare("SELECT * FROM outbox WHERE status='pending' AND next_at<=? ORDER BY id LIMIT 10").all(Date.now())) || [];
        if (!due.length) break;
        for (const row of due) {
          if (closed) return;
          try {
            await perform(JSON.parse(row.payload));
            safe(() => db.prepare("UPDATE outbox SET status='sent', attempts=attempts+1, error='', sent_at=? WHERE id=?").run(new Date().toISOString(), row.id));
          } catch (error) {
            const attempts = row.attempts + 1;
            const done = attempts > BACKOFF.length;
            safe(() => db.prepare('UPDATE outbox SET status=?, attempts=?, error=?, next_at=? WHERE id=?').run(done ? 'failed' : 'pending', attempts, errorText(error), Date.now() + (BACKOFF[attempts - 1] || 0), row.id));
          }
        }
      }
      safe(() => prune.run());
    } finally { running = false; }
  }
  const kick = () => { if (!closed) setImmediate(() => work().catch(error => console.error(error))); };

  // Staff-triggered and test messages are sent immediately and report the outcome.
  async function deliver(channel, event, target, payload) {
    let error = '';
    try { await perform(payload); } catch (reason) { error = errorText(reason); }
    safe(() => insert.run(new Date().toISOString(), Date.now(), 1, channel, event, String(target).slice(0, 300), JSON.stringify(payload), error ? 'failed' : 'sent', error, error ? null : new Date().toISOString()));
    return { ok: !error, error };
  }

  const history = () => db.prepare('SELECT id, created_at AS createdAt, channel, event, target, status, attempts, error FROM outbox ORDER BY id DESC LIMIT 60').all().map(row => ({ ...row, ok: row.status === 'sent' }));
  function retry(id) {
    const changed = db.prepare("UPDATE outbox SET status='pending', attempts=0, error='', next_at=? WHERE id=? AND status='failed'").run(Date.now(), id).changes;
    if (!changed) throw fail(404, 'errors.outboxNotFound');
    kick();
  }

  // ---- Content ----
  const adminLocale = () => settings.values().defaultLocale;
  const baseUrl = origin => config.siteUrl || publicOrigin || origin || '';
  const tr = (locale, key, params) => translate(locale, key, params);
  const brand = appearance => appearance.brandName || 'Quesuwa';

  function answerRows(locale, fields, answers, attachments, limit = 12) {
    const rows = [];
    for (const field of fields) {
      if (!answerable(field)) continue;
      const files = attachments.filter(file => file.fieldId === field.id);
      const value = field.type === 'file' ? (files.length ? tr(locale, 'notify.attachments', { count: files.length }) : '') : formatAnswer(field, answers[field.id], tr(locale, 'common.listSeparator'));
      if (value) rows.push({ label: field.label, value: value.length > 300 ? value.slice(0, 297) + '…' : value });
    }
    return { rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
  }

  function renderEmail(locale, { heading, intro, quote = '', rows = [], more = 0, button = null, footer, signature = false }, appearance = config.appearance) {
    const color = appearance.color;
    const signatureText = signature ? appearance.signature : '';
    const footerText = [footer, appearance.footer].filter(Boolean).join('\n');
    const rowHtml = rows.map(row => `<tr><td style="padding:6px 0;color:#6B5C59;font-size:13px;vertical-align:top;width:38%">${escapeHtml(row.label)}</td><td style="padding:6px 0 6px 12px;color:#3A2F2E;font-size:14px;white-space:pre-wrap">${escapeHtml(row.value)}</td></tr>`).join('');
    const logo = appearance.logoUrl ? `<img src="${escapeHtml(appearance.logoUrl)}" alt="${escapeHtml(brand(appearance))}" height="32" style="display:block;height:32px;max-width:200px;margin-bottom:8px">` : '';
    const html = `<!doctype html><html><body style="margin:0;background:#F4EDE8;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EDE8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBF7F4;border:1px solid #E3D5CE;border-radius:14px;overflow:hidden">
<tr><td style="height:6px;background:${color}"></td></tr>
<tr><td style="padding:24px 28px">
${logo}<div style="font-size:12px;letter-spacing:.08em;color:${color};font-weight:700">${escapeHtml(brand(appearance).toUpperCase())}</div>
<h1 style="margin:8px 0 12px;font-size:20px;color:#3A2F2E">${escapeHtml(heading)}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3A2F2E">${escapeHtml(intro)}</p>
${quote ? `<div style="margin:0 0 16px;padding:12px 14px;border-left:3px solid ${color};background:#F3EBE6;border-radius:8px;font-size:14px;line-height:1.6;color:#3A2F2E;white-space:pre-wrap">${escapeHtml(quote)}</div>` : ''}
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E3D5CE;margin-bottom:12px">${rowHtml}</table>` : ''}
${more ? `<p style="margin:0 0 16px;font-size:13px;color:#8F7F7B">${escapeHtml(tr(locale, 'notify.moreAnswers', { count: more }))}</p>` : ''}
${button ? `<a href="${escapeHtml(button.url)}" style="display:inline-block;margin:4px 0 8px;padding:10px 18px;background:${color};color:#FFFFFF;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(button.text)}</a>` : ''}
${signatureText ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#6B5C59;white-space:pre-wrap">${escapeHtml(signatureText)}</p>` : ''}
</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #E3D5CE;font-size:12px;color:#8F7F7B;white-space:pre-wrap">${escapeHtml(footerText)}</td></tr>
</table></td></tr></table></body></html>`;
    const textBody = [heading, '', intro, quote ? '\n' + quote + '\n' : '', ...rows.map(row => `${row.label}: ${row.value}`), more ? tr(locale, 'notify.moreAnswers', { count: more }) : '', button ? `\n${button.text}: ${button.url}` : '', signatureText ? '\n' + signatureText : '', '', '--', footerText].join('\n');
    return { html, text: textBody };
  }

  function telegramText({ heading, title, id, quote = '', rows = [], link = '', linkText = '' }) {
    const lines = [`<b>${escapeHtml(heading)}</b>`, `${escapeHtml(title)} · #${escapeHtml(shortId(id))}`];
    if (quote) lines.push('', escapeHtml(quote.length > 800 ? quote.slice(0, 797) + '…' : quote));
    if (rows.length) lines.push('', ...rows.slice(0, 8).map(row => `<b>${escapeHtml(row.label)}</b>: ${escapeHtml(row.value)}`));
    if (link) lines.push('', `<a href="${escapeHtml(link)}">${escapeHtml(linkText)}</a>`);
    return lines.join('\n').slice(0, 4000);
  }

  // ---- Recipients ----
  const members = () => db.prepare("SELECT id, email, notify_prefs FROM users WHERE disabled=0 AND email<>''").all().map(row => ({ id: row.id, email: row.email, prefs: parsePrefs(row.notify_prefs) }));
  const inScope = (prefs, formId) => prefs.scope !== 'selected' || prefs.forms.includes(formId);
  function alertRecipients(formId, event) {
    const subscribed = members().filter(member => (event === 'newResponse' ? member.prefs.newResponse : member.prefs.ticketReply) && inScope(member.prefs, formId)).map(member => member.email);
    return [...new Set([...config.alertMail.recipients, ...subscribed])];
  }

  const alertsReady = () => config.alertMail.enabled || config.telegram.enabled;
  const mailReady = () => config.mail.enabled;

  function alertAdmins(event, { formId, eventKey, title, id, subject, heading, intro, quote, rows = [], more = 0, link }) {
    const locale = adminLocale();
    const recipients = config.alertMail.enabled ? alertRecipients(formId, eventKey) : [];
    if (recipients.length) {
      const button = link ? { text: tr(locale, 'notify.viewResponse'), url: link } : null;
      enqueue('alertMail', event, recipients.join(', '), { kind: 'mail', profile: 'alertMail', message: { to: recipients, subject, ...renderEmail(locale, { heading, intro, quote, rows, more, button, footer: tr(locale, 'notify.footer', { brand: brand(config.appearance) }) }) } });
    }
    if (config.telegram.enabled) enqueue('telegram', event, config.telegram.chatIds.join(', '), { kind: 'telegram', text: telegramText({ heading, title, id, quote, rows, link, linkText: tr(locale, 'notify.viewResponse') }) });
  }

  const adminLink = (origin, formId, responseId) => { const base = baseUrl(origin); return base ? `${base}/admin/forms/${formId}/responses?r=${responseId}` : ''; };
  function followUpLink(origin, row, form) {
    const base = baseUrl(origin);
    const key = tickets.linkKey(row);
    return base && key && normalizeSettings(form.settings).ticketMode ? `${base}/t/${row.id}#k=${encodeURIComponent(key)}` : '';
  }
  const respondentLocale = row => row.locale || adminLocale();
  const recipientFor = (form, row) => contactEmail(JSON.parse(row.snapshot).fields, JSON.parse(row.answers), normalizeSettings(form.settings).contactField);

  // ---- Events ----
  function responseCreated({ form, row, origin }) {
    const settingsOfForm = normalizeSettings(form.settings);
    const fields = JSON.parse(row.snapshot).fields, answers = JSON.parse(row.answers), attachments = JSON.parse(row.attachments);
    if (settingsOfForm.notifyAdmins && config.events.newResponse && alertsReady()) {
      const locale = adminLocale();
      const { rows, more } = answerRows(locale, fields, answers, attachments);
      const params = { title: form.title, id: shortId(row.id) };
      alertAdmins('response.created', { formId: form.id, eventKey: 'newResponse', title: form.title, id: row.id, subject: tr(locale, 'notify.newSubject', params), heading: tr(locale, 'notify.newHeading'), intro: tr(locale, 'notify.newIntro', params), rows, more, link: adminLink(origin, form.id, row.id) });
    }
    const to = settingsOfForm.sendReceipt && mailReady() ? recipientFor(form, row) : '';
    if (to) {
      const locale = respondentLocale(row);
      const { rows, more } = answerRows(locale, fields, answers, attachments);
      const params = { title: form.title, id: shortId(row.id) };
      const link = followUpLink(origin, row, form);
      const content = renderEmail(locale, {
        heading: tr(locale, 'notify.receiptHeading'), intro: tr(locale, 'notify.receiptIntro', params) + (link ? ' ' + tr(locale, 'notify.ticketHint') : ''),
        quote: form.thanks || tr(locale, 'common.thanks'), rows, more,
        button: link ? { text: tr(locale, 'notify.openTicket'), url: link } : null, footer: tr(locale, 'notify.footerRespondent', { title: form.title })
      });
      enqueue('mail', 'receipt', to, { kind: 'mail', profile: 'mail', message: { to, replyTo: config.mail.replyTo || undefined, subject: tr(locale, 'notify.receiptSubject', params), ...content } });
    }
  }

  function ticketReplied({ form, row, message, origin }) {
    if (!config.events.ticketReply || !alertsReady()) return;
    const locale = adminLocale();
    const params = { title: form.title, id: shortId(row.id) };
    alertAdmins('message.created', { formId: form.id, eventKey: 'ticketReply', title: form.title, id: row.id, subject: tr(locale, 'notify.replySubject', params), heading: tr(locale, 'notify.replyHeading'), intro: tr(locale, 'notify.replyIntro', params), quote: message.body, link: adminLink(origin, form.id, row.id) });
  }

  function respondentEmail({ form, row, origin, kind, message = null, status }) {
    const locale = respondentLocale(row);
    const statusLabel = tr(locale, statusKeys[status] || 'status.pending');
    const params = { title: form.title, id: shortId(row.id), status: statusLabel, name: message?.authorName || '' };
    const link = followUpLink(origin, row, form);
    const reply = kind === 'message';
    const content = renderEmail(locale, {
      heading: tr(locale, reply ? 'notify.staffHeading' : 'notify.statusHeading'),
      intro: tr(locale, reply ? 'notify.staffIntro' : 'notify.statusIntro', params),
      quote: reply ? message.body + '\n\n' + tr(locale, 'notify.currentStatus', params) : '',
      button: link ? { text: tr(locale, 'notify.openTicket'), url: link } : null,
      footer: tr(locale, 'notify.footerRespondent', { title: form.title }),
      signature: true
    });
    return { subject: tr(locale, reply ? 'notify.staffSubject' : 'notify.statusSubject', params), ...content };
  }

  async function emailRespondent({ form, row, origin, kind, message = null, status }) {
    const to = recipientFor(form, row);
    if (!to || !mailReady()) return { ok: false, error: 'unavailable' };
    const content = respondentEmail({ form, row, origin, kind, message, status });
    return deliver('mail', kind === 'message' ? 'message.staff' : 'status.changed', to, { kind: 'mail', profile: 'mail', message: { to, replyTo: config.mail.replyTo || undefined, ...content } });
  }

  // ---- Daily digest ----
  function buildDigest(locale, since) {
    const forms = db.prepare(`SELECT f.id, f.definition, count(r.id) AS n FROM forms f JOIN responses r ON r.form_id=f.id AND r.deleted_at IS NULL AND r.created_at>=?
      WHERE f.deleted_at IS NULL GROUP BY f.id ORDER BY n DESC`).all(since).map(row => ({ label: JSON.parse(row.definition).title, value: tr(locale, 'notify.digestCount', { count: row.n }) }));
    const totals = db.prepare("SELECT SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END) AS pending, SUM(r.unread) AS unread FROM responses r JOIN forms f ON f.id=r.form_id WHERE r.deleted_at IS NULL AND f.deleted_at IS NULL").get();
    return { forms, pending: totals.pending || 0, unread: totals.unread || 0 };
  }

  function sendDigest(now = new Date()) {
    if (!config.digest.enabled || !config.alertMail.enabled) return false;
    const locale = adminLocale();
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const newCount = db.prepare('SELECT count(*) AS n FROM responses r JOIN forms f ON f.id=r.form_id WHERE r.deleted_at IS NULL AND f.deleted_at IS NULL AND r.created_at>=?').get(since).n;
    const { forms, pending, unread } = buildDigest(locale, since);
    if (config.digest.onlyActive && !newCount && !unread) return false;
    const recipients = [...new Set([...(config.digest.toRecipients ? config.alertMail.recipients : []), ...members().filter(member => member.prefs.digest).map(member => member.email)])];
    if (!recipients.length) return false;
    const base = baseUrl('');
    const content = renderEmail(locale, {
      heading: tr(locale, 'notify.digestHeading'),
      intro: tr(locale, 'notify.digestIntro', { count: newCount, pending, unread }),
      rows: forms.slice(0, 20),
      more: Math.max(0, forms.length - 20),
      button: base ? { text: tr(locale, 'notify.openWorkspace'), url: `${base}/admin` } : null,
      footer: tr(locale, 'notify.footer', { brand: brand(config.appearance) })
    });
    enqueue('alertMail', 'digest', recipients.join(', '), { kind: 'mail', profile: 'alertMail', message: { to: recipients, subject: tr(locale, 'notify.digestSubject', { count: newCount }), ...content } });
    return true;
  }

  // Runs from the scheduler: sends the digest once per local day after the configured hour.
  function digestTick(now = new Date()) {
    if (!config.digest.enabled) return;
    const zone = settings.values().timezone;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) < config.digest.hour) return;
    const last = safe(() => JSON.parse(db.prepare("SELECT value FROM settings WHERE key='digestLast'").get()?.value || 'null'));
    if (last === today) return;
    db.prepare("INSERT INTO settings(key, value) VALUES ('digestLast', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(today));
    sendDigest(now);
  }

  // ---- Previews and tests ----
  function preview(kind, appearanceInput) {
    const appearance = appearanceOf(appearanceInput, config.appearance);
    const locale = adminLocale();
    const sample = { title: tr(locale, 'notify.sampleTitle'), id: 'A1B2C3D4', status: tr(locale, 'status.inProgress'), name: tr(locale, 'notify.sampleName') };
    const button = { text: tr(locale, 'notify.openTicket'), url: '#' };
    if (kind === 'alert') return renderEmail(locale, { heading: tr(locale, 'notify.newHeading'), intro: tr(locale, 'notify.newIntro', sample), rows: [{ label: tr(locale, 'notify.sampleQuestion'), value: tr(locale, 'notify.sampleAnswer') }], button: { text: tr(locale, 'notify.viewResponse'), url: '#' }, footer: tr(locale, 'notify.footer', { brand: brand(appearance) }) }, appearance).html;
    if (kind === 'receipt') return renderEmail(locale, { heading: tr(locale, 'notify.receiptHeading'), intro: tr(locale, 'notify.receiptIntro', sample), quote: tr(locale, 'common.thanks'), rows: [{ label: tr(locale, 'notify.sampleQuestion'), value: tr(locale, 'notify.sampleAnswer') }], button, footer: tr(locale, 'notify.footerRespondent', sample) }, appearance).html;
    return renderEmail(locale, { heading: tr(locale, 'notify.staffHeading'), intro: tr(locale, 'notify.staffIntro', sample), quote: tr(locale, 'notify.sampleReply') + '\n\n' + tr(locale, 'notify.currentStatus', sample), button, footer: tr(locale, 'notify.footerRespondent', sample), signature: true }, appearance).html;
  }

  async function test(channel, to, requester = '') {
    const locale = adminLocale();
    const content = renderEmail(locale, { heading: tr(locale, 'notify.testSubject'), intro: tr(locale, 'notify.testBody'), footer: tr(locale, 'notify.footer', { brand: brand(config.appearance) }) });
    if (channel === 'alertMail') {
      const recipients = [...new Set([...config.alertMail.recipients, requester].filter(Boolean))];
      if (!config.alertMail.host || !config.alertMail.fromAddress || !recipients.length) throw invalid('errors.notifyIncomplete');
      return deliver('alertMail', 'test', recipients.join(', '), { kind: 'mail', profile: 'alertMail', message: { to: recipients, subject: tr(locale, 'notify.testSubject'), ...content } });
    }
    if (channel === 'mail') {
      const target = email(to);
      if (!target || !config.mail.host || !config.mail.fromAddress) throw invalid('errors.notifyIncomplete');
      return deliver('mail', 'test', target, { kind: 'mail', profile: 'mail', message: { to: target, replyTo: config.mail.replyTo || undefined, subject: tr(locale, 'notify.testSubject'), ...content } });
    }
    if (channel === 'telegram') {
      if (!config.telegram.token || !config.telegram.chatIds.length) throw invalid('errors.notifyIncomplete');
      return deliver('telegram', 'test', config.telegram.chatIds.join(', '), { kind: 'telegram', text: `<b>${escapeHtml(tr(locale, 'notify.testSubject'))}</b>\n${escapeHtml(tr(locale, 'notify.testBody'))}` });
    }
    if (channel === 'digest') {
      if (!config.alertMail.host || !config.alertMail.fromAddress) throw invalid('errors.notifyIncomplete');
      const saved = config.digest;
      config = { ...config, digest: { ...saved, enabled: true, onlyActive: false, toRecipients: true } };
      try { if (!sendDigest()) throw invalid('errors.digestNoRecipients'); } finally { config = { ...config, digest: saved }; }
      return { ok: true, error: '', queued: true };
    }
    throw invalid('errors.notifyInvalid');
  }

  // Resume anything left pending by a previous run.
  kick();

  return {
    masked, update, history, retry, test, preview, work, digestTick, templates: () => config.templates,
    status: () => ({ alerts: alertsReady(), mail: mailReady(), alertMail: config.alertMail.enabled }),
    recipientFor, followUpLink, responseCreated, ticketReplied, emailRespondent,
    close() { closed = true; }
  };
}

// Member notification preferences with safe defaults.
export function parsePrefs(raw) {
  let value = {};
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw || {}; } catch { value = {}; }
  return {
    scope: value.scope === 'selected' ? 'selected' : 'all',
    forms: Array.isArray(value.forms) ? value.forms.filter(id => typeof id === 'string').slice(0, 200) : [],
    newResponse: value.newResponse === true,
    ticketReply: value.ticketReply === true,
    digest: value.digest === true
  };
}
