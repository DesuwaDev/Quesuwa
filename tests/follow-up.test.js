import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { createApp } from '../server/app.js';
import { RESPONDENT_BURST } from '../server/services/tickets.js';

// Minimal SMTP sink that records every message.
function smtpSink() {
  const mails = [];
  const server = createServer(socket => {
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
  return { mails, server };
}

async function setup(t) {
  const sink = smtpSink();
  await new Promise(resolve => sink.server.listen(0, '127.0.0.1', resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-follow-up-'));
  const password = 'follow-up-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); sink.server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (url, method = 'GET', body) => fetch(base + '/api/admin' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie }, body: body && JSON.stringify(body) });
  const smtpProfile = { enabled: true, host: '127.0.0.1', port: sink.server.address().port, security: 'none', user: 'mailer', pass: 'secret-pass', fromAddress: 'noreply@example.test' };
  assert.equal((await admin('/notifications', 'PUT', { siteUrl: 'https://survey.example.test', mail: smtpProfile, conversation: { delayMinutes: 0 } })).status, 200);
  const submit = async (slug, version, answers) => {
    const body = new FormData();
    body.set('answers', JSON.stringify(answers));
    body.set('version', String(version));
    body.set('locale', 'en');
    return (await fetch(`${base}/api/forms/${slug}/responses`, { method: 'POST', body })).json();
  };
  const ticket = (id, key, method = 'GET', payload) => fetch(`${base}/api/tickets/${id}${method === 'POST' ? '/messages' : ''}`, { method, headers: { Origin: base, 'Content-Type': 'application/json', 'X-Ticket-Key': key }, body: payload && JSON.stringify(payload) });
  const until = async (check, label) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(check(), label);
  };
  const decoded = mail => mail.body.replace(/=\n/g, '').replace(/=3D/g, '=');
  return { admin, submit, ticket, until, decoded, mails: sink.mails };
}

const fields = [{ id: 'q', type: 'long', label: 'Issue', required: true }, { id: 'mail', type: 'email', label: 'Email' }];

test('follow-up links can be revoked and reissued; earlier links stop working', async t => {
  const { admin, submit, ticket } = await setup(t);
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true }, fields })).json();
  const submitted = await submit('support', form.version, { q: 'Help me' });
  const first = submitted.ticket.key;
  assert.equal((await ticket(submitted.id, first)).status, 200);
  const detail = await (await admin(`/responses/${submitted.id}`)).json();
  assert.equal(detail.canIssueLink, true);
  assert.ok(detail.followUpUrl.endsWith(`#k=${first}`), 'the link from submission is still the current one');

  const reissued = await (await admin(`/responses/${submitted.id}/follow-up`, 'POST', { action: 'reissue' })).json();
  const second = new URL(reissued.followUpUrl).hash.replace('#k=', '');
  assert.notEqual(second, first);
  assert.equal((await ticket(submitted.id, first)).status, 404, 'the old link stops working');
  assert.equal((await ticket(submitted.id, second)).status, 200, 'the new link works');

  const revoked = await (await admin(`/responses/${submitted.id}/follow-up`, 'POST', { action: 'revoke' })).json();
  assert.deepEqual(revoked, { ticket: false, followUpUrl: '' });
  assert.equal((await ticket(submitted.id, second)).status, 404, 'no link works after revoking');
  assert.equal((await ticket(submitted.id, second, 'POST', { body: 'still here?' })).status, 404);
  const afterRevoke = await (await admin(`/responses/${submitted.id}`)).json();
  assert.equal(afterRevoke.conversation, true, 'staff keep the conversation and can issue a new link');

  const third = new URL((await (await admin(`/responses/${submitted.id}/follow-up`, 'POST', { action: 'reissue' })).json()).followUpUrl).hash.replace('#k=', '');
  assert.equal((await ticket(submitted.id, third)).status, 200);
  assert.equal((await admin(`/responses/${submitted.id}/follow-up`, 'POST', { action: 'nope' })).status, 400);
  const actions = (await (await admin('/system')).json()).events.items.map(entry => entry.action);
  assert.ok(actions.includes('ticketLinkRevoked') && actions.includes('ticketLinkReissued'), 'both actions are audited');
});

test('a staff reply gives the respondent a fresh message allowance', async t => {
  const { admin, submit, ticket } = await setup(t);
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true }, fields })).json();
  const submitted = await submit('support', form.version, { q: 'Help me' });
  const send = body => ticket(submitted.id, submitted.ticket.key, 'POST', { body });
  for (let i = 0; i < RESPONDENT_BURST; i++) assert.equal((await send(`message ${i}`)).status, 201);
  const blocked = await send('one too many');
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'errors.ticketTooFast');
  assert.equal((await admin(`/responses/${submitted.id}/messages`, 'POST', { body: 'Got it, one moment' })).status, 201);
  assert.equal((await send('thanks')).status, 201, 'a staff reply refreshes the allowance');
});

test('emails can leave answers and replies out', async t => {
  const { admin, submit, until, decoded, mails } = await setup(t);
  const form = await (await admin('/forms', 'POST', { title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true, sendReceipt: true, contactField: 'mail' }, fields })).json();
  const full = await submit('support', form.version, { q: 'Printer on fire', mail: 'user@example.test' });
  await until(() => mails.some(mail => mail.to.includes('user@example.test')), 'receipt delivered');
  assert.ok(decoded(mails.find(mail => mail.to.includes('user@example.test'))).includes('Printer on fire'), 'by default the receipt repeats the answers');
  await admin(`/responses/${full.id}/messages`, 'POST', { body: 'Visible reply text', email: true });
  assert.ok(decoded(mails.at(-1)).includes('Visible reply text'), 'by default the reply email carries the reply');

  const quiet = await (await admin(`/forms/${form.id}`, 'PUT', { ...form, settings: { ...form.settings, mailExcerpts: false } })).json();
  assert.equal(quiet.settings.mailExcerpts, false);
  await admin(`/responses/${full.id}/messages`, 'POST', { body: 'Hidden reply text', email: true });
  const replyMail = decoded(mails.at(-1));
  assert.ok(!replyMail.includes('Hidden reply text'), 'the reply stays behind the link');
  assert.ok(replyMail.includes(`/t/${full.id}#k=`), 'the email still links to the conversation');

  const count = mails.length;
  await submit('support', quiet.version, { q: 'Toaster leaking', mail: 'user@example.test' });
  await until(() => mails.slice(count).some(mail => mail.to.includes('user@example.test')), 'second receipt delivered');
  assert.ok(!decoded(mails.slice(count).find(mail => mail.to.includes('user@example.test'))).includes('Toaster leaking'), 'the receipt leaves the answers out');
});
