import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

test('roles, protected forms, logic pages and exports', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-features-'));
  const password = 'features-owner-password-123';
  const instance = createApp({ dataDir, password });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (cookie, url, method = 'GET', body) => fetch(base + '/api' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const signIn = async (username, secret) => (await call('', '/admin/login', 'POST', { username, password: secret })).headers.get('set-cookie')?.split(';')[0];
  const owner = await signIn('admin', password);

  // Viewers can read but not write; owners cannot remove the last owner.
  assert.equal((await call(owner, '/admin/users', 'POST', { username: 'viewer', role: 'viewer', password: 'viewer-password-12' })).status, 201);
  const viewer = await signIn('viewer', 'viewer-password-12');
  assert.equal((await call(viewer, '/admin/forms', 'POST', { title: 'x', state: 'draft', fields: [] })).status, 403);
  assert.equal((await call(viewer, '/admin/users')).status, 403);
  const self = (await (await call(owner, '/admin/session')).json()).user;
  assert.equal((await call(owner, `/admin/users/${self.id}`, 'PATCH', { role: 'viewer' })).status, 400);

  const fields = [
    { id: 'plan', type: 'single', label: 'Plan', options: ['Free', 'Pro'], required: true, allowOther: true },
    { id: 'page2', type: 'section', label: 'Pro details', logic: { match: 'all', rules: [{ fieldId: 'plan', op: 'equals', value: 'Pro' }] } },
    { id: 'seats', type: 'number', label: 'Seats', required: true, integer: true, min: 1 },
    { id: 'grid', type: 'matrix', label: 'Grid', rows: ['Speed', 'Price'], columns: ['Bad', 'Good'], required: true },
    { id: 'order', type: 'ranking', label: 'Order', options: ['A', 'B', 'C'] },
    { id: 'score', type: 'nps', label: 'Score' }
  ];
  let res = await call(owner, '/admin/forms', 'POST', { title: 'Features', state: 'published', fields, settings: { accessCode: 'OPEN-123', onePerDevice: true, listed: true } });
  assert.equal(res.status, 201);
  const form = await res.json();
  const publicForm = await (await call('', `/forms/${form.slug}`)).json();
  assert.equal(publicForm.locked, true);
  assert.equal(publicForm.fields, undefined);
  assert.equal((await call('', `/forms/${form.slug}/access`, 'POST', { accessCode: 'wrong' })).status, 403);
  const unlocked = await (await call('', `/forms/${form.slug}/access`, 'POST', { accessCode: 'OPEN-123' })).json();
  assert.equal(unlocked.fields.length, fields.length);
  assert.equal(unlocked.settings.accessCode, undefined);

  const submit = (answers, extra = {}) => {
    const body = new FormData();
    body.set('answers', JSON.stringify(answers));
    body.set('version', String(form.version));
    body.set('accessCode', extra.code ?? 'OPEN-123');
    return fetch(`${base}/api/forms/${form.slug}/responses`, { method: 'POST', headers: { Origin: base, ...(extra.cookie ? { Cookie: extra.cookie } : {}) }, body });
  };
  assert.equal((await submit({ plan: 'Free' }, { code: 'nope' })).status, 403);
  // The hidden page is skipped entirely for Free plans; hidden answers are discarded.
  res = await submit({ plan: 'Free', seats: 'ignored', score: '9' });
  assert.equal(res.status, 201);
  const deviceCookie = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await submit({ plan: 'Free' }, { cookie: deviceCookie })).status, 409);
  assert.equal((await submit({ plan: 'Pro', seats: '2.5', grid: ['Good', 'Bad'] })).status, 400);
  assert.equal((await submit({ plan: 'Pro', seats: '3', grid: ['Good'] })).status, 400);
  assert.equal((await submit({ plan: 'Pro', seats: '3', grid: ['Good', 'Bad'], order: ['A'] })).status, 400);
  assert.equal((await submit({ plan: 'Pro', seats: '3', grid: ['Good', 'Bad'], order: ['C', 'A', 'B'], score: '4' })).status, 201);
  assert.equal((await submit({ plan: 'Enterprise' })).status, 201);

  const listed = await (await call(owner, `/admin/forms/${form.id}/responses`)).json();
  assert.equal(listed.total, 3);
  assert.equal(listed.items.find(item => item.answers.plan === 'Free').answers.seats, undefined);

  const stats = await (await call(owner, `/admin/forms/${form.id}/statistics`)).json();
  const plan = stats.fields.find(field => field.id === 'plan');
  assert.equal(plan.other, 1);
  assert.deepEqual(stats.fields.find(field => field.id === 'score').nps, { promoters: 0, passives: 0, detractors: 1, score: -100 });
  assert.equal(stats.fields.find(field => field.id === 'order').ranking[0].label, 'C');

  const csv = await (await call(owner, `/admin/forms/${form.id}/export?lang=en`)).text();
  assert.match(csv, /"Grid \[Speed\]"/);
  assert.match(csv, /"1\. C；2\. A；3\. B"|"1\. C; 2\. A; 3\. B"/);
  const json = await (await call(owner, `/admin/forms/${form.id}/export?format=json`)).json();
  assert.equal(json.responses.length, 3);
  assert.equal((await call(owner, `/admin/forms/${form.id}/attachments`)).status, 404);
  assert.equal((await call(viewer, `/admin/forms/${form.id}/export`)).status, 200);
  const definition = await (await call(owner, `/admin/forms/${form.id}/definition`)).json();
  assert.equal(definition.slug, undefined);
  assert.equal(definition.fields[1].logic.rules[0].value, 'Pro');
});

test('option conditions hide choices and conditional required applies on the server', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-conditions-'));
  const password = 'conditions-owner-password';
  const instance = createApp({ dataDir, password });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const fields = [
    { id: 'role', type: 'single', label: 'Role', options: ['Student', 'Staff'], required: true },
    { id: 'area', type: 'multi', label: 'Area', options: ['Library', 'Canteen', 'Office'], allowOther: true,
      optionLogic: [{ option: 'Office', logic: { match: 'all', rules: [{ fieldId: 'role', op: 'equals', value: 'Staff' }] } }] },
    { id: 'reason', type: 'long', label: 'Reason', requiredLogic: { match: 'all', rules: [{ fieldId: 'role', op: 'equals', value: 'Student' }] } },
    { id: 'office', type: 'select', label: 'Office only', options: ['A', 'B'], optionLogic: ['A', 'B'].map(option => ({ option, logic: { match: 'all', rules: [{ fieldId: 'role', op: 'equals', value: 'Staff' }] } })) }
  ];
  const created = await fetch(base + '/api/admin/forms', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: JSON.stringify({ title: 'Conditions', slug: 'conditions', state: 'published', fields }) });
  assert.equal(created.status, 201);
  const form = await created.json();
  assert.equal(form.fields[1].optionLogic[0].option, 'Office');
  assert.equal(form.fields[2].requiredLogic.rules[0].value, 'Student');
  const submit = answers => {
    const body = new FormData();
    body.set('answers', JSON.stringify(answers));
    body.set('version', String(form.version));
    return fetch(`${base}/api/forms/conditions/responses`, { method: 'POST', body });
  };
  // Students cannot pick the staff-only option, even through the "Other" box, and must give a reason.
  assert.equal((await submit({ role: 'Student', area: ['Office'], reason: 'x' })).status, 400);
  assert.equal((await submit({ role: 'Student', area: ['Library'] })).status, 400);
  assert.equal((await submit({ role: 'Student', area: ['Library'], reason: 'Quiet' })).status, 201);
  // Staff see every option; the reason stays optional. A question with no visible options is skipped.
  assert.equal((await submit({ role: 'Staff', area: ['Office'], office: 'A' })).status, 201);
  assert.equal((await submit({ role: 'Student', area: ['Canteen'], reason: 'Food', office: 'A' })).status, 201);
  const responses = await (await fetch(`${base}/api/admin/forms/${form.id}/responses?sort=oldest`, { headers: { Cookie } })).json();
  assert.equal(responses.items[2].answers.office, undefined);
  // Option conditions must reference an existing option of the same question.
  const invalid = await fetch(`${base}/api/admin/forms/${form.id}`, { method: 'PUT', headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: JSON.stringify({ ...form, fields: [fields[0], { ...fields[1], optionLogic: [{ option: 'Missing', logic: fields[1].optionLogic[0].logic }] }] }) });
  assert.equal(invalid.status, 400);
});

test('first-run setup in the web UI and runtime settings', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-setup-'));
  const instance = createApp({ dataDir, maxStorageMB: 64 });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, cookie = '', method = 'POST') => fetch(base + '/api' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  assert.equal((await (await fetch(base + '/api/admin/setup')).json()).needed, true);
  const owner = { username: 'owner', password: 'owner-password-123', displayName: 'Owner' };
  assert.equal((await post('/admin/setup', { ...owner, code: 'WRONG' })).status, 403);
  const created = await post('/admin/setup', { ...owner, code: instance.setupCode().toLowerCase() });
  assert.equal(created.status, 201);
  const cookie = created.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await fetch(base + '/api/admin/setup')).json()).needed, false);
  assert.equal((await post('/admin/setup', { ...owner, code: 'ANY' })).status, 409);
  const system = await (await fetch(base + '/api/admin/system', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(system.settings.locked, ['maxStorageMB']);
  assert.equal((await post('/admin/system/settings', { maxStorageMB: 10 }, cookie, 'PUT')).status, 400);
  assert.equal((await post('/admin/system/settings', { trustProxyHops: 9 }, cookie, 'PUT')).status, 400);
  const saved = await (await post('/admin/system/settings', { defaultLocale: 'en', trustProxyHops: 1 }, cookie, 'PUT')).json();
  assert.equal(saved.values.defaultLocale, 'en');
  const error = await (await fetch(base + '/api/admin/forms')).json();
  assert.equal(error.error, 'Please sign in to the admin workspace.');
});

test('ticket mode lets respondents and staff exchange messages', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-tickets-'));
  const password = 'ticket-owner-password-1';
  const instance = createApp({ dataDir, password });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true }, fields: [{ id: 'q', type: 'long', label: 'Issue', required: true }] })).json();
  const body = new FormData();
  body.set('answers', JSON.stringify({ q: 'Help me' }));
  body.set('version', String(form.version));
  const submitted = await (await fetch(base + '/api/forms/support/responses', { method: 'POST', body })).json();
  assert.ok(submitted.ticket.key);
  const ticket = (method = 'GET', payload, key = submitted.ticket.key) => fetch(`${base}/api/tickets/${submitted.id}${method === 'POST' ? '/messages' : ''}`, { method, headers: { Origin: base, 'Content-Type': 'application/json', 'X-Ticket-Key': key }, body: payload && JSON.stringify(payload) });
  assert.equal((await ticket('GET', undefined, 'wrong')).status, 404);
  assert.equal((await (await ticket()).json()).fields[0].value, 'Help me');
  assert.equal((await admin(`/responses/${submitted.id}/messages`, 'POST', { body: 'Please send logs', status: 'needsInfo' })).status, 201);
  const view = await (await ticket('POST', { body: 'Here they are' })).json();
  assert.equal(view.status, 'pending');
  assert.deepEqual(view.messages.map(message => message.author + ':' + message.body), ['staff:Please send logs', 'system:status:needsInfo', 'respondent:Here they are', 'system:status:pending']);
  assert.equal((await (await admin(`/forms/${form.id}/responses?unread=true`)).json()).total, 1);
  await admin(`/responses/${submitted.id}/read`, 'POST', {});
  assert.equal((await (await admin(`/forms/${form.id}/responses?unread=true`)).json()).total, 0);
  assert.equal((await ticket('POST', { body: '   ' })).status, 400);
  assert.equal((await fetch(`${base}/t/${submitted.id}`)).headers.get('x-robots-tag'), 'noindex, nofollow');
  // Turning ticket mode off stops replies but keeps the history readable.
  await admin(`/forms/${form.id}`, 'PUT', { ...form, settings: { ...form.settings, ticketMode: false } });
  assert.equal((await ticket('POST', { body: 'More' })).status, 410);
  assert.equal((await (await ticket()).json()).messages.length, 4);
});

test('notifications: admin alerts, Telegram, receipts and respondent emails', async t => {
  const { createServer } = await import('node:net');
  const { createServer: createHttpServer } = await import('node:http');
  // Minimal SMTP sink that records every message.
  const mails = [];
  const smtp = createServer(socket => {
    let data = false, buffer = '', current = { to: [], body: '' };
    socket.write('220 sink\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === '.') { data = false; mails.push(current); current = { to: [], body: '' }; socket.write('250 ok\r\n'); }
          else current.body += line + '\n';
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'RCPT') current.to.push(line.replace(/^RCPT TO:<(.*)>.*$/i, '$1'));
        if (command === 'DATA') { data = true; socket.write('354 go\r\n'); }
        else if (command === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  const telegramCalls = [];
  const telegram = createHttpServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { telegramCalls.push({ url: req.url, body: JSON.parse(body) }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
  });
  await Promise.all([new Promise(r => smtp.listen(0, '127.0.0.1', r)), new Promise(r => telegram.listen(0, '127.0.0.1', r))]);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-notify-'));
  const password = 'notify-owner-password-1';
  let instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    instance.close();
    smtp.close(); telegram.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const until = async (check, label) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(check(), label);
  };
  const smtpProfile = { enabled: true, host: '127.0.0.1', port: smtp.address().port, security: 'none', user: 'mailer', pass: 'secret-pass', fromAddress: 'noreply@example.test' };
  let res = await admin('/notifications', 'PUT', {
    siteUrl: 'https://survey.example.test/ignored-path',
    alertMail: { ...smtpProfile, recipients: ['team@example.test'] },
    mail: { ...smtpProfile, replyTo: 'support@example.test' },
    telegram: { enabled: true, token: '12345:abcdefghijklmnopqrstuvwxyz', chatIds: ['42'], apiBase: `http://127.0.0.1:${telegram.address().port}` },
    templates: [{ title: 'Thanks', body: 'Thanks for the details.' }]
  });
  assert.equal(res.status, 200);
  const saved = (await res.json()).config;
  assert.equal(saved.siteUrl, 'https://survey.example.test');
  assert.equal(saved.alertMail.pass, '');
  assert.equal(saved.alertMail.hasPass, true);
  assert.equal(saved.telegram.hasToken, true);
  // Updating without a password keeps the stored one.
  assert.equal((await (await admin('/notifications', 'PUT', { alertMail: { ...smtpProfile, pass: '', recipients: ['team@example.test'] } })).json()).config.alertMail.hasPass, true);
  assert.equal((await admin('/notifications', 'PUT', { appearance: { color: 'red' } })).status, 400);
  assert.equal((await admin('/notifications', 'PUT', { appearance: { logoUrl: 'http://insecure.test/logo.png' } })).status, 400);
  assert.deepEqual(await (await admin('/messaging')).json(), { alerts: true, mail: true, alertMail: true, templates: [{ id: saved.templates[0].id, title: 'Thanks', body: 'Thanks for the details.' }] });
  const preview = await (await admin('/notifications/preview', 'POST', { kind: 'reply', appearance: { brandName: 'Acme Care', color: '#123456', signature: 'Team Acme' } })).json();
  assert.ok(preview.html.includes('ACME CARE') && preview.html.includes('#123456') && preview.html.includes('Team Acme'));

  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true, sendReceipt: true }, fields: [{ id: 'q', type: 'long', label: 'Issue', required: true }, { id: 'mail', type: 'email', label: 'Email' }] })).json();
  const body = new FormData();
  body.set('answers', JSON.stringify({ q: 'Printer on fire', mail: 'user@example.test' }));
  body.set('version', String(form.version));
  body.set('locale', 'en');
  const submitted = await (await fetch(base + '/api/forms/support/responses', { method: 'POST', body })).json();
  await until(() => mails.length >= 2 && telegramCalls.length >= 1, 'alert and receipt delivered');
  const decoded = mail => mail.body.replace(/=\n/g, '').replace(/=3D/g, '=');
  const alert = mails.find(mail => mail.to.includes('team@example.test'));
  const receipt = mails.find(mail => mail.to.includes('user@example.test'));
  assert.match(alert.body, /Subject: New response: Support/);
  assert.ok(decoded(alert).includes(`https://survey.example.test/admin/forms/${form.id}/responses?r=${submitted.id}`), 'alert links to the response');
  assert.match(receipt.body, /Reply-To: support@example.test/);
  assert.ok(decoded(receipt).includes(`https://survey.example.test/t/${submitted.id}#k=${submitted.ticket.key}`), 'receipt carries the follow-up link');
  assert.equal(telegramCalls[0].url, '/bot12345:abcdefghijklmnopqrstuvwxyz/sendMessage');
  assert.equal(telegramCalls[0].body.chat_id, '42');
  assert.match(telegramCalls[0].body.text, /Printer on fire/);

  const detail = await (await admin(`/responses/${submitted.id}`)).json();
  assert.equal(detail.contactEmail, 'user@example.test');
  assert.equal(detail.conversation, true);
  const reply = await (await admin(`/responses/${submitted.id}/messages`, 'POST', { body: 'We are on it', email: true })).json();
  assert.equal(reply.delivery.ok, true);
  assert.equal(reply.message.delivery, 'sent');
  assert.match(mails.at(-1).body, /You have a new reply/);
  const status = await (await admin(`/responses/${submitted.id}`, 'PATCH', { status: 'resolved', notify: true })).json();
  assert.equal(status.event.body, 'status:resolved');
  assert.equal(status.delivery.ok, true);
  assert.match(mails.at(-1).body, /Subject: Status update: Resolved/);

  const before = mails.length;
  await fetch(`${base}/api/tickets/${submitted.id}/messages`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Ticket-Key': submitted.ticket.key }, body: JSON.stringify({ body: 'Still smoking' }) });
  await until(() => mails.length > before && telegramCalls.length >= 2, 'ticket reply alert delivered');
  assert.match(mails.at(-1).body, /Subject: New ticket reply: Support/);
  const timeline = (await (await admin(`/responses/${submitted.id}`)).json()).messages.map(message => message.author + ':' + message.body);
  assert.deepEqual(timeline, ['staff:We are on it', 'system:status:resolved', 'respondent:Still smoking', 'system:status:pending']);

  assert.equal((await (await admin('/notifications/test', 'POST', { channel: 'telegram' })).json()).ok, true);
  assert.equal((await admin('/notifications/test', 'POST', { channel: 'mail', to: 'not-an-email' })).status, 400);
  const log = (await (await admin('/notifications')).json()).log;
  assert.ok(log.length >= 6 && log.every(entry => entry.ok));

  // Members subscribe with their own address; the digest reaches them and the alert list.
  assert.equal((await admin('/me', 'PATCH', { email: 'owner@example.test', notifyPrefs: { scope: 'selected', forms: [form.id], newResponse: true, digest: true } })).status, 200);
  assert.equal((await admin('/notifications/test', 'POST', { channel: 'digest' })).status, 200);
  await until(() => mails.some(mail => /Subject: Daily summary/.test(mail.body)), 'digest delivered');
  assert.deepEqual(mails.find(mail => /Subject: Daily summary/.test(mail.body)).to.sort(), ['owner@example.test', 'team@example.test']);

  // Undeliverable alerts stay queued, survive a restart and can be retried by hand.
  const dead = createServer();
  await new Promise(r => dead.listen(0, '127.0.0.1', r));
  const deadPort = dead.address().port;
  await new Promise(r => dead.close(r));
  await admin('/notifications', 'PUT', { alertMail: { ...smtpProfile, port: deadPort, recipients: ['team@example.test'] } });
  const second = new FormData();
  second.set('answers', JSON.stringify({ q: 'Second issue' }));
  second.set('version', String(form.version));
  await fetch(base + '/api/forms/support/responses', { method: 'POST', body: second });
  let queued;
  await until(() => (queued = instance.notifier.history().find(entry => entry.event === 'response.created' && entry.channel === 'alertMail' && entry.attempts >= 1 && !entry.ok)), 'failed alert stays queued');
  assert.equal(queued.status, 'pending');
  assert.ok(queued.error);
  await admin('/notifications', 'PUT', { alertMail: { ...smtpProfile, recipients: ['team@example.test'] } });
  await new Promise(resolve => server.close(resolve));
  instance.close();
  const { DatabaseSync } = await import('node:sqlite');
  const sql = statement => { const raw = new DatabaseSync(path.join(dataDir, 'report.sqlite')); raw.exec(statement); raw.close(); };
  sql(`UPDATE outbox SET next_at=0 WHERE id=${queued.id}`);
  const count = mails.length;
  instance = createApp({ dataDir, password, defaultLocale: 'en' });
  await until(() => mails.length > count, 'queued alert delivered after restart');
  assert.equal(instance.notifier.history().find(entry => entry.id === queued.id).status, 'sent');
  sql(`UPDATE outbox SET status='failed' WHERE id=${queued.id}`);
  instance.notifier.retry(queued.id);
  await until(() => mails.length > count + 1, 'manual retry delivered');
  assert.throws(() => instance.notifier.retry(queued.id));
});

test('two-step sign-in, API tokens, backups and retention', async t => {
  const { hotp } = await import('../server/lib/totp.js');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-security-'));
  const password = 'security-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (headers, url, method = 'GET', body) => fetch(base + '/api' + url, { method, headers: Object.fromEntries(Object.entries({ Origin: base, 'Content-Type': 'application/json', ...headers }).filter(([, value]) => value)), body: body === undefined ? undefined : JSON.stringify(body) });
  const cookieOf = res => res.headers.get('set-cookie')?.split(';')[0];
  const owner = { Cookie: cookieOf(await call({}, '/admin/login', 'POST', { password })) };
  const code = (secret, offset = 0) => hotp(secret, Math.floor(Date.now() / 30_000) + offset);

  // Enrol: a wrong code is refused, the right one returns recovery codes.
  const setup = await (await call(owner, '/admin/2fa/setup', 'POST')).json();
  assert.match(setup.url, /^otpauth:\/\/totp\//);
  assert.equal((await call(owner, '/admin/2fa/enable', 'POST', { code: code(setup.secret) === '000000' ? '111111' : '000000' })).status, 400);
  const enabled = await (await call(owner, '/admin/2fa/enable', 'POST', { code: code(setup.secret) })).json();
  assert.equal(enabled.user.twoFactor, true);
  assert.equal(enabled.recoveryCodes.length, 10);
  assert.equal((await call(owner, '/admin/session')).status, 200, 'current session survives enrolment');

  // Sign-in now needs the second factor; codes cannot be replayed.
  let login = await (await call({}, '/admin/login', 'POST', { password })).json();
  assert.equal(login.twoFactor, true);
  assert.equal((await call({}, '/admin/login/2fa', 'POST', { challenge: login.challenge, code: code(setup.secret) })).status, 401, 'enrolment code cannot be replayed');
  let res = await call({}, '/admin/login/2fa', 'POST', { challenge: login.challenge, code: code(setup.secret, 1) });
  assert.equal(res.status, 200);
  login = await (await call({}, '/admin/login', 'POST', { password })).json();
  res = await call({}, '/admin/login/2fa', 'POST', { challenge: login.challenge, code: enabled.recoveryCodes[0] });
  assert.equal(res.status, 200, 'recovery code signs in');
  login = await (await call({}, '/admin/login', 'POST', { password })).json();
  assert.equal((await call({}, '/admin/login/2fa', 'POST', { challenge: login.challenge, code: enabled.recoveryCodes[0] })).status, 401, 'recovery codes are single use');
  assert.equal((await (await call(owner, '/admin/me')).json()).recoveryLeft, 9);

  // Owners can reset another member's second factor.
  await call(owner, '/admin/users', 'POST', { username: 'editor', role: 'editor', password: 'editor-password-12', email: 'editor@example.test' });
  const editorCookie = { Cookie: cookieOf(await call({}, '/admin/login', 'POST', { username: 'editor', password: 'editor-password-12' })) };
  const editorSetup = await (await call(editorCookie, '/admin/2fa/setup', 'POST')).json();
  await call(editorCookie, '/admin/2fa/enable', 'POST', { code: code(editorSetup.secret) });
  const editor = (await (await call(owner, '/admin/users')).json()).find(user => user.username === 'editor');
  assert.equal(editor.twoFactor, true);
  assert.equal(editor.email, 'editor@example.test');
  assert.equal((await (await call(owner, `/admin/users/${editor.id}/reset-2fa`, 'POST')).json()).twoFactor, false);

  // API tokens: shown once, read-only scope enforced, sensitive areas session-only, revocable.
  const read = await (await call(owner, '/admin/tokens', 'POST', { name: 'Reporting', scope: 'read', days: 30 })).json();
  const write = await (await call(owner, '/admin/tokens', 'POST', { name: 'Automation', scope: 'write' })).json();
  assert.match(read.secret, /^qsw_/);
  assert.ok(read.token.expiresAt && !write.token.expiresAt);
  assert.ok(!JSON.stringify(await (await call(owner, '/admin/tokens')).json()).includes(read.secret));
  const bearer = token => ({ Authorization: `Bearer ${token}`, Origin: '' });
  assert.equal((await call(bearer(read.secret), '/admin/forms')).status, 200);
  assert.equal((await call(bearer(read.secret), '/admin/forms', 'POST', { title: 'x', state: 'draft', fields: [] })).status, 403);
  assert.equal((await call(bearer(write.secret), '/admin/forms', 'POST', { title: 'Via API', state: 'published', fields: [{ id: 'q', type: 'short', label: 'Q' }], settings: { retentionDays: 30 } })).status, 201);
  for (const url of ['/admin/users', '/admin/system', '/admin/notifications', '/admin/tokens', '/admin/me']) assert.equal((await call(bearer(write.secret), url)).status, 403, url);
  assert.equal((await call(bearer('qsw_' + 'x'.repeat(40)), '/admin/forms')).status, 401);
  await call(owner, `/admin/tokens/${read.token.id}`, 'DELETE');
  assert.equal((await call(bearer(read.secret), '/admin/forms')).status, 401);

  // Retention removes answers older than the questionnaire's limit.
  const forms = await (await call(owner, '/admin/forms')).json();
  const form = (forms.items || forms).find(item => item.title === 'Via API');
  for (const answer of ['old', 'new']) {
    const body = new FormData();
    body.set('answers', JSON.stringify({ q: answer }));
    body.set('version', String(form.version));
    await fetch(`${base}/api/forms/${form.slug}/responses`, { method: 'POST', body });
  }
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path.join(dataDir, 'report.sqlite'));
  raw.prepare("UPDATE responses SET created_at=? WHERE answers LIKE '%old%'").run(new Date(Date.now() - 40 * 86400_000).toISOString());
  raw.close();
  assert.equal(instance.retention.run(), 1);
  const left = await (await call(owner, `/admin/forms/${form.id}/responses`)).json();
  assert.deepEqual((left.items || left).map(item => item.answers.q), ['new']);

  // Backups: settings validated, snapshots listed and downloadable, full archive is a ZIP.
  assert.equal((await call(owner, '/admin/system/backups', 'PUT', { hour: 24 })).status, 400);
  assert.equal((await (await call(owner, '/admin/system/backups', 'PUT', { enabled: true, hour: 2, keep: 2 })).json()).config.keep, 2);
  for (let i = 0; i < 3; i++) {
    const ran = await (await call(owner, '/admin/system/backups/run', 'POST')).json();
    assert.equal(ran.status.ok, true);
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  const backups = await (await call(owner, '/admin/system/backups')).json();
  assert.equal(backups.items.length, 2, 'old snapshots are pruned');
  const snapshot = await call(owner, `/admin/system/backups/${backups.items[0].name}`);
  assert.equal(snapshot.status, 200);
  assert.equal(Buffer.from(await snapshot.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await call(owner, '/admin/system/backups/..%2Freport.sqlite')).status, 404);
  const archive = await call(owner, '/admin/system/archive');
  assert.equal(Buffer.from(await archive.arrayBuffer()).subarray(0, 2).toString(), 'PK');
});
