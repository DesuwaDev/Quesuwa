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
    conversation: { delayMinutes: 0 },
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

test('link prefill parameters and environment diagnostics', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-env-'));
  const password = 'environment-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const fields = [{ id: 'site', type: 'single', label: 'Site', options: ['Main', 'Mirror'], prefillKey: 'site' }, { id: 'what', type: 'long', label: 'What happened' }];

  assert.equal((await admin('/forms', 'POST', { title: 'Bad', state: 'draft', fields: [{ ...fields[0], prefillKey: '1site' }] })).status, 400);
  assert.equal((await admin('/forms', 'POST', { title: 'Bad', state: 'draft', fields: [fields[0], { ...fields[1], prefillKey: 'SITE' }] })).status, 400);
  // Keys are dropped for question types that cannot be prefilled.
  const kept = await (await admin('/forms', 'POST', { title: 'Files', state: 'draft', fields: [{ id: 'f', type: 'file', label: 'Upload', prefillKey: 'upload' }] })).json();
  assert.equal(kept.fields[0].prefillKey, undefined);

  const form = await (await admin('/forms', 'POST', { title: 'Bug report', slug: 'bug', state: 'published', settings: { collectEnvironment: true }, fields })).json();
  assert.equal(form.fields[0].prefillKey, 'site');
  const submit = async environment => {
    const body = new FormData();
    body.set('answers', JSON.stringify({ site: 'Mirror', what: 'Blank page' }));
    body.set('version', String(form.version));
    if (environment !== undefined) body.set('environment', environment);
    return (await fetch(base + '/api/forms/bug/responses', { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }, body })).json();
  };
  const first = await submit(JSON.stringify({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', screen: '1920x1080', viewport: '1280x720', pixelRatio: 1.25, timeZone: 'Asia/Shanghai', referrer: 'javascript:alert(1)', page: '/f/bug?site=Mirror', colorScheme: 'dark', injected: 'nope', language: 'zh-CN' }));
  const detail = await (await admin('/responses/' + first.id)).json();
  assert.deepEqual(detail.environment, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', platform: '', mobile: false, touch: false, screen: '1920x1080', viewport: '1280x720', pixelRatio: 1.25, language: 'zh-CN', timeZone: 'Asia/Shanghai', colorScheme: 'dark', referrer: '', page: '/f/bug?site=Mirror' });
  // Missing or malformed details fall back to the request's user agent.
  const second = await submit('{not json');
  assert.match((await (await admin('/responses/' + second.id)).json()).environment.userAgent, /iPhone OS 17_5/);
  const csv = await (await admin(`/forms/${form.id}/export?format=csv`)).text();
  assert.ok(csv.includes('Chrome 128 · Windows · 1280×720 · Asia/Shanghai'));
  assert.ok(csv.includes('Safari 17.5 · iOS 17.5'));

  // Forms that do not ask for diagnostics store none.
  await admin(`/forms/${form.id}`, 'PUT', { ...form, settings: { ...form.settings, collectEnvironment: false } });
  const plain = await (await admin(`/forms/${form.id}`)).json();
  const body = new FormData();
  body.set('answers', JSON.stringify({ what: 'x' }));
  body.set('version', String(plain.version));
  body.set('environment', JSON.stringify({ userAgent: 'x' }));
  const third = await (await fetch(base + '/api/forms/bug/responses', { method: 'POST', body })).json();
  assert.equal((await (await admin('/responses/' + third.id)).json()).environment, null);
});

test('closed tickets stop replies and resolved tickets auto-close', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-close-'));
  const password = 'closing-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true, autoCloseDays: 7 }, fields: [{ id: 'q', type: 'long', label: 'Issue' }] })).json();
  assert.equal(form.settings.autoCloseDays, 7);
  const submit = async () => {
    const body = new FormData();
    body.set('answers', JSON.stringify({ q: 'Broken' }));
    body.set('version', String(form.version));
    return (await fetch(base + '/api/forms/support/responses', { method: 'POST', body })).json();
  };
  const reply = (ticket, text) => fetch(`${base}/api/tickets/${ticket.id}/messages`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Ticket-Key': ticket.key }, body: JSON.stringify({ body: text }) });
  const view = async ticket => (await fetch(`${base}/api/tickets/${ticket.id}`, { headers: { 'X-Ticket-Key': ticket.key } })).json();

  // Closing is final for the respondent until staff reopen it.
  const first = (await submit()).ticket;
  assert.equal((await admin(`/responses/${first.id}`, 'PATCH', { status: 'closed' })).status, 200);
  const closed = await view(first);
  assert.equal(closed.canReply, false);
  assert.equal(closed.closed, true);
  assert.equal(closed.formSlug, 'support');
  const refused = await reply(first, 'Still broken');
  assert.equal(refused.status, 410);
  assert.equal((await refused.json()).code, 'errors.ticketLocked');
  await admin(`/responses/${first.id}`, 'PATCH', { status: 'resolved' });
  assert.equal((await reply(first, 'Back again')).status, 201);
  assert.equal((await (await admin(`/responses/${first.id}`)).json()).status, 'pending', 'replying to a resolved ticket reopens it');

  // Resolved tickets without activity for the configured period close automatically.
  const second = (await submit()).ticket;
  await admin(`/responses/${second.id}`, 'PATCH', { status: 'resolved' });
  assert.equal(instance.autoClose.run(), 0, 'recently resolved tickets stay open');
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path.join(dataDir, 'report.sqlite'));
  raw.prepare('UPDATE responses SET last_activity_at=? WHERE id=?').run(new Date(Date.now() - 8 * 86400_000).toISOString(), second.id);
  raw.close();
  assert.equal(instance.autoClose.run(), 1);
  const detail = await (await admin(`/responses/${second.id}`)).json();
  assert.equal(detail.status, 'closed');
  assert.equal(detail.messages.at(-1).body, 'status:closed');
  assert.equal((await reply(second, 'Hello?')).status, 410);
  assert.equal((await (await admin(`/forms/${form.id}/responses?status=closed`)).json()).items.length, 1);
});

test('conversations update live through long polling', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-live-'));
  const password = 'live-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true }, fields: [{ id: 'q', type: 'long', label: 'Issue' }] })).json();
  const body = new FormData();
  body.set('answers', JSON.stringify({ q: 'Broken' }));
  body.set('version', String(form.version));
  const { ticket } = await (await fetch(base + '/api/forms/support/responses', { method: 'POST', body })).json();
  const headers = { 'X-Ticket-Key': ticket.key };
  const view = await (await fetch(`${base}/api/tickets/${ticket.id}`, { headers })).json();
  assert.ok(view.rev);

  // An outdated revision answers immediately.
  const stale = await fetch(`${base}/api/tickets/${ticket.id}/wait?rev=old`, { headers });
  assert.equal(stale.status, 200);
  assert.equal((await stale.json()).rev, view.rev);

  // A current revision waits until staff reply, then returns the new message.
  const started = Date.now();
  const waiting = fetch(`${base}/api/tickets/${ticket.id}/wait?rev=${view.rev}`, { headers });
  await new Promise(resolve => setTimeout(resolve, 300));
  await admin(`/responses/${ticket.id}/messages`, 'POST', { body: 'Looking into it' });
  const woke = await waiting;
  assert.equal(woke.status, 200);
  const updated = await woke.json();
  assert.ok(Date.now() - started < 5000, 'woken by the reply, not by the timeout');
  assert.equal(updated.messages.at(-1).body, 'Looking into it');
  assert.notEqual(updated.rev, view.rev);

  // Staff see respondent replies the same way.
  const detail = await (await admin(`/responses/${ticket.id}`)).json();
  const staffWait = admin(`/responses/${ticket.id}/wait?rev=${detail.rev}`);
  await new Promise(resolve => setTimeout(resolve, 300));
  await fetch(`${base}/api/tickets/${ticket.id}/messages`, { method: 'POST', headers: { ...headers, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Thanks!' }) });
  const state = await (await staffWait).json();
  assert.equal(state.messages.at(-1).body, 'Thanks!');
  assert.equal(state.unread, true);
  assert.equal(state.status, 'pending');
  // Bad keys never get to wait.
  assert.equal((await fetch(`${base}/api/tickets/${ticket.id}/wait?rev=x`, { headers: { 'X-Ticket-Key': 'wrong' } })).status, 404);

  // A send retried after a lost answer is stored once, for respondents and staff alike.
  const resend = () => fetch(`${base}/api/tickets/${ticket.id}/messages`, { method: 'POST', headers: { ...headers, Origin: base, 'Content-Type': 'application/json', 'Idempotency-Key': 'retry-key-0001' }, body: JSON.stringify({ body: 'Sent twice' }) });
  assert.equal((await resend()).status, 201);
  const again = await resend();
  assert.equal(again.status, 201);
  assert.equal((await again.json()).messages.filter(message => message.body === 'Sent twice').length, 1);
  const staffSend = () => fetch(`${base}/api/admin/responses/${ticket.id}/messages`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie, 'Idempotency-Key': 'staff-key-0001' }, body: JSON.stringify({ body: 'Staff twice' }) });
  const firstStaff = await (await staffSend()).json();
  const secondStaff = await (await staffSend()).json();
  assert.equal(secondStaff.repeated, true);
  assert.equal(secondStaff.message.id, firstStaff.message.id);
  const final = await (await admin(`/responses/${ticket.id}`)).json();
  assert.equal(final.messages.filter(message => message.body === 'Staff twice').length, 1);
});

test('conversation emails are combined while people keep talking', async t => {
  const { createServer } = await import('node:net');
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
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-batch-'));
  const password = 'batching-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); instance.close(); smtp.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const profile = { enabled: true, host: '127.0.0.1', port: smtp.address().port, security: 'none', fromAddress: 'noreply@example.test' };
  assert.equal((await admin('/notifications', 'PUT', { conversation: { delayMinutes: 30, maxMinutes: 15 } })).status, 400);
  await admin('/notifications', 'PUT', { alertMail: { ...profile, recipients: ['team@example.test'] }, mail: profile, events: { newResponse: false, ticketReply: true }, conversation: { delayMinutes: 2, maxMinutes: 15, skipIfSeen: true } });
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true }, fields: [{ id: 'q', type: 'long', label: 'Issue' }, { id: 'mail', type: 'email', label: 'Email' }] })).json();
  const body = new FormData();
  body.set('answers', JSON.stringify({ q: 'Broken', mail: 'user@example.test' }));
  body.set('version', String(form.version));
  const { ticket } = await (await fetch(base + '/api/forms/support/responses', { method: 'POST', body })).json();
  const later = minutes => Date.now() + minutes * 60_000;
  const settle = () => new Promise(resolve => setTimeout(resolve, 300));

  // Three quick staff replies become one email once the conversation pauses.
  for (const text of ['First note', 'Second note', 'Third note']) {
    const reply = await (await admin(`/responses/${ticket.id}/messages`, 'POST', { body: text, email: true })).json();
    assert.equal(reply.delivery.queued, true);
    assert.equal(reply.message.delivery, 'queued');
  }
  await instance.notifier.conversationTick(later(1));
  assert.equal(mails.length, 0, 'still inside the quiet period');
  await instance.notifier.conversationTick(later(3));
  await settle();
  assert.equal(mails.length, 1);
  const combined = mails[0].body.replace(/=\n/g, '');
  assert.ok(['First note', 'Second note', 'Third note'].every(text => combined.includes(text)));
  assert.match(mails[0].body, /3 new replies/);
  let detail = await (await admin(`/responses/${ticket.id}`)).json();
  assert.deepEqual(detail.messages.filter(message => message.author === 'staff').map(message => message.delivery), ['sent', 'sent', 'sent']);

  // A reply the respondent already saw on the follow-up page is not emailed.
  const seenLive = await (await admin(`/responses/${ticket.id}/messages`, 'POST', { body: 'Seen live', email: true })).json();
  // Opening the page alone is not reading; the page reports messages that were on screen.
  await fetch(`${base}/api/tickets/${ticket.id}`, { headers: { 'X-Ticket-Key': ticket.key } });
  await fetch(`${base}/api/tickets/${ticket.id}/read`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Ticket-Key': ticket.key }, body: JSON.stringify({ ids: [seenLive.message.id] }) });
  await instance.notifier.conversationTick(later(3));
  await settle();
  assert.equal(mails.length, 1);
  detail = await (await admin(`/responses/${ticket.id}`)).json();
  assert.equal(detail.messages.at(-1).delivery, 'seen');

  // Respondent replies reach the team as one alert, and not at all once someone has read them.
  const respond = text => fetch(`${base}/api/tickets/${ticket.id}/messages`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Ticket-Key': ticket.key }, body: JSON.stringify({ body: text }) });
  await respond('Still broken');
  await respond('Here is more detail');
  await settle();
  assert.equal(mails.length, 1, 'no alert per message');
  await instance.notifier.conversationTick(later(3));
  await settle();
  await instance.notifier.work();
  await settle();
  assert.equal(mails.length, 2);
  assert.deepEqual(mails[1].to, ['team@example.test']);
  assert.match(mails[1].body, /2 new replies/);
  await respond('One more thing');
  await admin(`/responses/${ticket.id}/read`, 'POST', {});
  await instance.notifier.conversationTick(later(3));
  await instance.notifier.work();
  await settle();
  assert.equal(mails.length, 2, 'already read, so no alert');
});

test('conversation editing, read receipts and attachments', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-conv-'));
  const password = 'conversation-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Cookie }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true }, fields: [{ id: 'q', type: 'long', label: 'Issue' }] })).json();
  const submit = async () => {
    const body = new FormData();
    body.set('answers', JSON.stringify({ q: 'Broken' }));
    body.set('version', String(form.version));
    return (await (await fetch(base + '/api/forms/support/responses', { method: 'POST', body })).json()).ticket;
  };
  const ticket = await submit();
  const keyHeaders = { 'X-Ticket-Key': ticket.key };
  const respondent = (url = '', init = {}) => fetch(`${base}/api/tickets/${ticket.id}${url}`, { ...init, headers: { Origin: base, ...keyHeaders, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const view = async () => (await respondent()).json();

  // Editing: the respondent sees only the new text; staff keep the original and a marker.
  const asked = await (await respondent('/messages', { method: 'POST', body: JSON.stringify({ body: 'Pasword reset broken' }) })).json();
  const typo = asked.messages.at(-1);
  const staffReply = await (await admin(`/responses/${ticket.id}/messages`, 'POST', { body: 'We will **check** it' })).json();
  assert.equal((await admin(`/responses/${ticket.id}/messages/${typo.id}`, 'PATCH', { body: 'Password reset broken' })).status, 200);
  let mine = (await view()).messages.find(message => message.id === typo.id);
  assert.equal(mine.body, 'Password reset broken');
  assert.deepEqual(Object.keys(mine).sort(), ['attachments', 'author', 'authorName', 'body', 'createdAt', 'id']);
  let staffSide = (await (await admin(`/responses/${ticket.id}`)).json()).messages.find(message => message.id === typo.id);
  assert.equal(staffSide.originalBody, 'Pasword reset broken');
  assert.ok(staffSide.editedAt && staffSide.editedBy);
  const systemEvent = (await (await admin(`/responses/${ticket.id}`, 'PATCH', { status: 'inProgress' })).json()).event;
  assert.equal((await admin(`/responses/${ticket.id}/messages/${systemEvent.id}`, 'PATCH', { body: 'x' })).status, 404);

  // Retracting hides a message from the respondent only; restoring brings it back.
  assert.equal((await admin(`/responses/${ticket.id}/messages/${staffReply.message.id}`, 'DELETE')).status, 200);
  assert.ok(!(await view()).messages.some(message => message.id === staffReply.message.id));
  staffSide = (await (await admin(`/responses/${ticket.id}`)).json()).messages.find(message => message.id === staffReply.message.id);
  assert.ok(staffSide.deletedAt);
  assert.equal((await respondent('/read', { method: 'POST', body: JSON.stringify({ ids: [staffReply.message.id] }) })).ok, true);
  assert.equal((await (await admin(`/responses/${ticket.id}`)).json()).messages.find(message => message.id === staffReply.message.id).readAt, null, 'retracted messages are not marked read');
  await admin(`/responses/${ticket.id}/messages/${staffReply.message.id}/restore`, 'POST', {});
  assert.ok((await view()).messages.some(message => message.id === staffReply.message.id));

  // Read receipts: only staff messages that the page reports, with the time they were read.
  const marked = await (await respondent('/read', { method: 'POST', body: JSON.stringify({ ids: [staffReply.message.id, typo.id, 'unknown'] }) })).json();
  assert.equal(marked.marked, 1);
  const receipts = (await (await admin(`/responses/${ticket.id}`)).json()).messages;
  assert.ok(receipts.find(message => message.id === staffReply.message.id).readAt);
  assert.equal(receipts.find(message => message.id === typo.id).readAt, null);

  // Attachments: checked by content, fetched with the key, and switchable per conversation.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const upload = (files, text = '') => {
    const body = new FormData();
    body.set('body', text);
    for (const [name, content, type] of files) body.append('files', new Blob([content], { type }), name);
    return respondent('/messages', { method: 'POST', body });
  };
  let sent = await upload([['shot.png', png, 'image/png'], ['console.log', 'TypeError: x is undefined', 'text/plain']]);
  assert.equal(sent.status, 201);
  const withFiles = (await sent.json()).messages.at(-1);
  assert.equal(withFiles.body, '');
  assert.deepEqual(withFiles.attachments.map(file => [file.name, file.mime]), [['shot.png', 'image/png'], ['console.log', 'text/plain']]);
  const image = await respondent(`/files/${withFiles.attachments[0].id}?inline=1`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await fetch(`${base}/api/tickets/${ticket.id}/files/${withFiles.attachments[0].id}`, { headers: { 'X-Ticket-Key': 'wrong' } })).status, 404);
  assert.equal((await admin(`/responses/${ticket.id}/conversation-files/${withFiles.attachments[1].id}`)).status, 200);
  assert.equal((await upload([['fake.png', 'not an image', 'image/png']])).status, 400, 'content decides the type, not the name');
  assert.ok((await (await admin('/system')).json()).files >= 2, 'conversation files count towards storage');

  // Staff can stop this conversation from accepting files; the questionnaire can too.
  assert.equal((await (await admin(`/responses/${ticket.id}`, 'PATCH', { filesDisabled: true })).json()).filesDisabled, true);
  assert.equal((await view()).files.allowed, false);
  sent = await upload([['shot.png', png, 'image/png']]);
  assert.equal(sent.status, 403);
  assert.equal((await sent.json()).code, 'errors.ticketFilesOff');
  await admin(`/responses/${ticket.id}`, 'PATCH', { filesDisabled: false });
  const current = await (await admin(`/forms/${form.id}`)).json();
  await admin(`/forms/${form.id}`, 'PUT', { ...current, settings: { ...current.settings, ticketFiles: false } });
  assert.equal((await view()).files.allowed, false);
  assert.equal((await upload([['shot.png', png, 'image/png']])).status, 403);

  // Staff attachments, and the storage quota covers conversations too.
  const staffFiles = new FormData();
  staffFiles.set('body', 'See the attached guide');
  staffFiles.append('files', new Blob([png], { type: 'image/png' }), 'guide.png');
  const staffAttached = await (await admin(`/responses/${ticket.id}/messages`, 'POST', staffFiles)).json();
  assert.equal(staffAttached.message.attachments[0].name, 'guide.png');
  await admin('/system/settings', 'PUT', { maxStorageMB: 1 });
  const big = new FormData();
  big.append('files', new Blob([Buffer.concat([png, Buffer.alloc(1024 * 1024 + 10)])], { type: 'image/png' }), 'huge.png');
  assert.equal((await admin(`/responses/${ticket.id}/messages`, 'POST', big)).status, 507);

  // Deleting the response for good removes conversation files from disk.
  const stored = path.join(dataDir, 'uploads', withFiles.attachments[0].id);
  assert.ok(fs.existsSync(stored));
  await admin(`/forms/${form.id}/responses/batch`, 'POST', { ids: [ticket.id], action: 'trash' });
  await admin(`/forms/${form.id}/responses/batch`, 'POST', { ids: [ticket.id], action: 'purge', confirmation: form.title });
  assert.ok(!fs.existsSync(stored));
});

test('human verification before submitting', async t => {
  const { createServer } = await import('node:http');
  const { solveCap } = await import('./helpers/cap-solver.js');
  // A stand-in for every provider's siteverify endpoint: "good-<provider>" tokens pass.
  const calls = [];
  const verifier = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const fields = req.headers['content-type'].includes('json') ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
      const provider = req.url.endsWith('/siteverify') ? 'cap' : req.url.slice(1);
      calls.push({ provider, fields });
      res.setHeader('Content-Type', 'application/json');
      if (provider === 'recaptchaV3') return res.end(JSON.stringify({ success: true, action: fields.response.split(':')[1], score: Number(fields.response.split(':')[2]) }));
      res.end(JSON.stringify({ success: fields.response === 'good-' + provider }));
    });
  });
  await new Promise(resolve => verifier.listen(0, '127.0.0.1', resolve));
  const at = path => `http://127.0.0.1:${verifier.address().port}/${path}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-captcha-'));
  const password = 'captcha-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en', captchaEndpoints: { turnstile: at('turnstile'), hcaptcha: at('hcaptcha'), recaptcha: ['http://127.0.0.1:9/unreachable', at('recaptcha')], recaptchaV3: at('recaptchaV3') } });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); verifier.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const configure = body => admin('/system/captcha', 'PUT', body);
  const form = await (await admin('/forms', 'POST', { title: 'Guarded', slug: 'guarded', state: 'published', settings: { captcha: true }, fields: [{ id: 'q', type: 'short', label: 'Q' }] })).json();
  const open = await (await admin('/forms', 'POST', { title: 'Open', slug: 'open-form', state: 'published', fields: [{ id: 'q', type: 'short', label: 'Q' }] })).json();
  const submit = (slug, version, headers = {}) => {
    const body = new FormData();
    body.set('answers', JSON.stringify({ q: 'hello' }));
    body.set('version', String(version));
    return fetch(`${base}/api/forms/${slug}/responses`, { method: 'POST', headers, body });
  };
  const code = async response => (await response.json()).code;

  // Switched on for a questionnaire but not configured anywhere: nothing is asked.
  assert.equal((await (await fetch(base + '/api/forms/guarded')).json()).captcha, null);
  assert.equal((await submit('guarded', form.version)).status, 201);

  // Keys are required for hosted providers; secrets are write-only.
  assert.equal(await code(await configure({ provider: 'turnstile', providers: { turnstile: { siteKey: 'site-t' } } })), 'errors.captchaKeys');
  let saved = await (await configure({ provider: 'turnstile', fallback: 'cap', providers: { turnstile: { siteKey: 'site-t', secret: 'secret-t' }, cap: { mode: 'builtin', strength: 'low' } } })).json();
  assert.equal(saved.config.providers.turnstile.secret, 'secret-t', 'owners can read their keys back');
  assert.deepEqual(saved.accepted ?? saved.config.accepted, ['turnstile', 'cap']);
  const view = await (await fetch(base + '/api/forms/guarded')).json();
  assert.deepEqual(view.captcha.primary, { provider: 'turnstile', siteKey: 'site-t' });
  assert.deepEqual(view.captcha.fallback, { provider: 'cap', siteKey: '', endpoint: '/api/captcha/cap/', workerCount: '2', timeout: 10 });
  assert.equal((await (await fetch(base + '/api/forms/open-form')).json()).captcha, null, 'only questionnaires that opt in ask');
  const policy = (await fetch(base + '/')).headers.get('content-security-policy');
  assert.match(policy, /script-src 'self' https:\/\/challenges\.cloudflare\.com 'wasm-unsafe-eval'/);
  assert.match(policy, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.doesNotMatch((await fetch(base + '/f/guarded')).headers.get('content-security-policy'), /nonce-|'unsafe-eval'/, 'built-in Cap needs no inline script');

  // Submissions need a valid token from the primary or the backup channel.
  assert.equal(await code(await submit('guarded', form.version)), 'errors.captchaRequired');
  assert.equal(await code(await submit('guarded', form.version, { 'X-Captcha-Token': 'bad', 'X-Captcha-Provider': 'turnstile' })), 'errors.captchaFailed');
  assert.equal(await code(await submit('guarded', form.version, { 'X-Captcha-Token': 'good-hcaptcha', 'X-Captcha-Provider': 'hcaptcha' })), 'errors.captchaFailed', 'channels that are not configured are refused');
  assert.equal((await submit('guarded', form.version, { 'X-Captcha-Token': 'good-turnstile', 'X-Captcha-Provider': 'turnstile' })).status, 201);
  assert.equal(calls.at(-1).fields.secret, 'secret-t');
  assert.equal((await submit('open-form', open.version)).status, 201, 'other questionnaires are unaffected');

  // The built-in Cap backup: challenge, solve, redeem, then a single-use token.
  const challenge = await (await fetch(base + '/api/captcha/cap/challenge', { method: 'POST', headers: { Origin: base } })).json();
  const redeemed = await (await fetch(base + '/api/captcha/cap/redeem', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(solveCap(challenge)) })).json();
  assert.equal(redeemed.success, true);
  const capHeaders = { 'X-Captcha-Token': redeemed.token, 'X-Captcha-Provider': 'cap' };
  assert.equal((await submit('guarded', form.version, capHeaders)).status, 201);
  assert.equal(await code(await submit('guarded', form.version, capHeaders)), 'errors.captchaFailed', 'tokens cannot be reused');
  const wrong = await (await fetch(base + '/api/captcha/cap/redeem', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: challenge.token, solutions: [1, 2, 3] }) })).json();
  assert.equal(wrong.success, false);

  // hCaptcha sends its site key; reCAPTCHA falls through to the mirror when the first origin is down.
  await configure({ provider: 'hcaptcha', fallback: 'none', providers: { hcaptcha: { siteKey: 'site-h', secret: 'secret-h' } } });
  assert.equal((await submit('guarded', form.version, { 'X-Captcha-Token': 'good-hcaptcha', 'X-Captcha-Provider': 'hcaptcha' })).status, 201);
  assert.equal(calls.at(-1).fields.sitekey, 'site-h');
  assert.equal((await (await fetch(base + '/api/captcha/cap/challenge', { method: 'POST', headers: { Origin: base } })).status), 404, 'built-in Cap only answers when it is in use');
  await configure({ provider: 'recaptcha', providers: { recaptcha: { siteKey: 'site-r', secret: 'secret-r', endpoint: 'auto' } } });
  assert.deepEqual((await (await fetch(base + '/api/captcha')).json()).primary.origins, ['https://www.google.com', 'https://www.recaptcha.net']);
  assert.equal((await submit('guarded', form.version, { 'X-Captcha-Token': 'good-recaptcha', 'X-Captcha-Provider': 'recaptcha' })).status, 201);

  // reCAPTCHA v3 decides on the score and the action.
  await configure({ provider: 'recaptchaV3', providers: { recaptchaV3: { siteKey: 'site-3', secret: 'secret-3', threshold: 0.6 } } });
  assert.equal((await submit('guarded', form.version, { 'X-Captcha-Token': 'v3:submit:0.9', 'X-Captcha-Provider': 'recaptchaV3' })).status, 201);
  assert.equal(await code(await submit('guarded', form.version, { 'X-Captcha-Token': 'v3:submit:0.3', 'X-Captcha-Provider': 'recaptchaV3' })), 'errors.captchaFailed');
  assert.equal(await code(await submit('guarded', form.version, { 'X-Captcha-Token': 'v3:login:0.9', 'X-Captcha-Provider': 'recaptchaV3' })), 'errors.captchaFailed');

  // Switching channels keeps everyone's keys.
  const kept = (await (await admin('/system/captcha')).json()).config.providers;
  assert.equal(kept.turnstile.secret, 'secret-t');
  assert.equal(kept.hcaptcha.siteKey, 'site-h');

  // A Cap failure route must point at a channel that can verify.
  assert.equal(await code(await configure({ provider: 'cap', fallback: 'none', capBlockedFallback: 'recaptchaV3', providers: { cap: { mode: 'builtin' }, recaptchaV3: { secret: '' } } })), 'errors.captchaKeys');
  assert.equal((await (await admin('/system/captcha')).json()).config.providers.recaptchaV3.secret, 'secret-3', 'a rejected save changes nothing');

  // Which channel the browser moves to, for every kind of failure.
  const { nextCaptchaChannel } = await import('../shared/captcha-routing.js');
  const routing = { fallback: { provider: 'turnstile' }, capFallbacks: { blocked: { provider: 'hcaptcha' }, network: null } };
  assert.equal(nextCaptchaChannel(routing, 'cap', 'blocked', ['cap'])?.provider, 'hcaptcha');
  assert.equal(nextCaptchaChannel(routing, 'cap', 'network', ['cap']), null, 'Cap network trouble set to fail outright');
  assert.equal(nextCaptchaChannel(routing, 'cap', 'unavailable', ['cap'])?.provider, 'turnstile', 'broken Cap scripts use the general backup');
  assert.equal(nextCaptchaChannel({ ...routing, fallback: { provider: 'turnstile' } }, 'turnstile', 'unavailable', ['turnstile']), null, 'never the same channel twice');
  assert.equal(nextCaptchaChannel(routing, 'hcaptcha', 'unavailable', ['cap', 'hcaptcha']), null, 'a backup that fails does not chain further');

  // Cap failures route on their own: refusals fail outright, network trouble uses the general backup.
  await configure({ provider: 'cap', fallback: 'turnstile', capBlockedFallback: 'none', capNetworkFallback: 'default', providers: { cap: { mode: 'builtin' } } });
  let routes = (await (await fetch(base + '/api/captcha')).json());
  assert.equal(routes.capFallbacks.blocked, null);
  assert.equal(routes.capFallbacks.network.provider, 'turnstile');
  await configure({ capBlockedFallback: 'hcaptcha', fallback: 'none' });
  routes = (await (await fetch(base + '/api/captcha')).json());
  assert.equal(routes.fallback, null);
  assert.equal(routes.capFallbacks.blocked.provider, 'hcaptcha');
  assert.equal(routes.capFallbacks.network, null, '"general backup" with no backup means no route');
  assert.equal((await submit('guarded', form.version, { 'X-Captcha-Token': 'good-hcaptcha', 'X-Captcha-Provider': 'hcaptcha' })).status, 201, 'a Cap failure route is an accepted channel');
  assert.equal(await code(await submit('guarded', form.version, { 'X-Captcha-Token': 'good-turnstile', 'X-Captcha-Provider': 'turnstile' })), 'errors.captchaFailed', 'channels no route reaches are refused');

  // A self-hosted Cap server is called with JSON at <server>/<site key>/siteverify,
  // optionally through a separate address for server-side checks.
  assert.equal(await code(await configure({ provider: 'cap', fallback: 'none', providers: { cap: { mode: 'standalone', serverUrl: 'https://cap.example.test?x=1', siteKey: 'k', secret: 's' } } })), 'errors.captchaServerUrl');
  await configure({ provider: 'cap', fallback: 'none', providers: { cap: { mode: 'standalone', serverUrl: 'https://cap.example.test/', verificationServerUrl: at('internal'), siteKey: 'abc', secret: 'cap-secret', timeout: '5' } } });
  assert.equal((await (await fetch(base + '/api/captcha')).json()).primary.endpoint, 'https://cap.example.test/abc/');
  assert.match((await fetch(base + '/')).headers.get('content-security-policy'), /connect-src 'self' https:\/\/cap\.example\.test/);
  // A self-hosted Cap server's browser check runs inline: pages that show the widget get a
  // fresh nonce (and eval for that check); other pages keep the strict policy.
  const shellNonce = response => /'nonce-([^']+)'/.exec(response.headers.get('content-security-policy'))?.[1];
  const shell = await fetch(base + '/f/guarded');
  const nonce = shellNonce(shell);
  assert.ok(nonce);
  assert.match(shell.headers.get('content-security-policy'), /'unsafe-eval'/);
  assert.equal(shell.headers.get('cache-control'), 'no-store');
  if (fs.existsSync(new URL('../dist/index.html', import.meta.url))) assert.ok((await shell.text()).includes(`<meta name="cap-nonce" content="${nonce}">`));
  assert.notEqual(shellNonce(await fetch(base + '/f/guarded')), nonce, 'a new nonce for every page');
  assert.ok(shellNonce(await fetch(base + '/admin/system')));
  for (const url of ['/', '/t/00000000-0000-0000-0000-000000000000', '/api/health']) assert.doesNotMatch((await fetch(base + url)).headers.get('content-security-policy'), /nonce-|'unsafe-eval'/, url);
  assert.equal((await submit('guarded', form.version, { 'X-Captcha-Token': 'good-cap', 'X-Captcha-Provider': 'cap' })).status, 201);
  assert.deepEqual(calls.at(-1).fields, { secret: 'cap-secret', response: 'good-cap' });
  assert.equal((await (await admin('/system/captcha')).json()).config.providers.cap.mode, 'standalone');

  // When no verification server answers, visitors are told it is temporary.
  const down = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-captcha-down-')), password, captchaEndpoints: { turnstile: 'http://127.0.0.1:9/unreachable' } });
  t.after(() => down.close());
  const downServer = down.app.listen(0, '127.0.0.1');
  await new Promise(resolve => downServer.once('listening', resolve));
  t.after(() => new Promise(resolve => downServer.close(resolve)));
  const downBase = `http://127.0.0.1:${downServer.address().port}`;
  const downCookie = (await fetch(downBase + '/api/admin/login', { method: 'POST', headers: { Origin: downBase, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).headers.get('set-cookie').split(';')[0];
  const downAdmin = (url, method, body) => fetch(downBase + '/api/admin' + url, { method, headers: { Origin: downBase, 'Content-Type': 'application/json', Cookie: downCookie }, body: JSON.stringify(body) });
  await downAdmin('/system/captcha', 'PUT', { provider: 'turnstile', providers: { turnstile: { siteKey: 's', secret: 'x' } } });
  const downForm = await (await downAdmin('/forms', 'POST', { title: 'G', slug: 'guarded', state: 'published', settings: { captcha: true }, fields: [{ id: 'q', type: 'short', label: 'Q' }] })).json();
  const body = new FormData();
  body.set('answers', JSON.stringify({ q: 'x' }));
  body.set('version', String(downForm.version));
  const unavailable = await fetch(downBase + '/api/forms/guarded/responses', { method: 'POST', headers: { 'X-Captcha-Token': 'anything', 'X-Captcha-Provider': 'turnstile' }, body });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'errors.captchaUnavailable');
});
