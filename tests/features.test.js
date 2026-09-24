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
