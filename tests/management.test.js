import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { normalizeSettings, normalizeRules, visibleFields, answerError } from '../src/form-rules.js';

async function setup(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-management-'));
  const password = 'management-tests-only-password';
  let instance = createApp({ dataDir, password });
  let server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = (url, method = 'GET', body, authenticated = true) => fetch(base + '/api' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = await request('/admin/login', 'POST', { password }); cookie = login.headers.get('set-cookie').split(';')[0];
  const submit = (form, answers, file, consent = 'true') => {
    const data = new FormData(); data.set('answers', JSON.stringify(answers)); data.set('version', form.version); data.set('consent', consent);
    if (file) data.set('files', new Blob(['diagnostic log'], { type: 'text/plain' }), 'error.log');
    return fetch(base + `/api/forms/${form.slug}/responses`, { method: 'POST', body: data });
  };
  async function restart() {
    await new Promise(resolve => server.close(resolve)); instance.close();
    instance = createApp({ dataDir, password }); server = instance.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  }
  return { request, submit, dataDir, restart, password };
}
const field = (id, type, required = false, extra = {}) => ({ id, type, required, label: id, options: [], ...extra });
const definition = (slug, extra = {}) => ({ slug, title: slug, state: 'published', fields: [field('text', 'short', true), field('files', 'file', false, { fileKinds: ['text'] })], ...extra });

test('management lifecycle enforces auth, soft deletion, restoration and attachment cleanup', async t => {
  const { request, submit, dataDir } = await setup(t);
  let form = await (await request('/admin/forms', 'POST', definition('lifecycle'))).json();
  assert.equal((await request(`/admin/forms/${form.id}`, 'DELETE', {}, false)).status, 401);
  assert.equal((await request(`/admin/forms/${form.id}?permanent=true`, 'DELETE', { confirmation: form.title })).status, 400);
  const response = await submit(form, { text: 'Find this response' }, true); assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, 1);
  const other = await (await request('/admin/forms', 'POST', definition('other-form'))).json();
  assert.equal((await request(`/admin/forms/${other.id}/responses/batch`, 'POST', { ids: [id], action: 'trash' })).status, 404);
  assert.equal((await (await request(`/admin/forms/${form.id}/responses?q=Find`)).json()).total, 1);
  assert.equal((await request(`/admin/forms/${form.id}/responses/batch`, 'POST', { ids: [id], action: 'status', status: 'resolved' })).status, 200);
  assert.equal((await (await request(`/admin/forms/${form.id}/statistics`)).json()).byStatus.resolved, 1);
  await request(`/admin/forms/${form.id}/responses/batch`, 'POST', { ids: [id], action: 'trash' });
  assert.equal((await (await request(`/admin/forms/${form.id}/responses`)).json()).total, 0);
  assert.equal((await (await request(`/admin/forms/${form.id}/responses?trash=true`)).json()).total, 1);
  await request(`/admin/forms/${form.id}/responses/batch`, 'POST', { ids: [id], action: 'restore' });
  await request(`/admin/forms/${form.id}`, 'DELETE', {});
  assert.equal((await request('/forms/lifecycle')).status, 404);
  assert.equal((await request(`/admin/forms/${form.id}`, 'PUT', form)).status, 404);
  assert.equal((await (await request('/admin/forms?trash=true')).json()).length, 1);
  form = await (await request(`/admin/forms/${form.id}/restore`, 'POST', {})).json();
  assert.equal(form.state, 'draft'); assert.equal(form.deletedAt, null);
  const copy = await (await request(`/admin/forms/${form.id}/duplicate`, 'POST', {})).json();
  assert.equal(copy.state, 'draft'); assert.notEqual(copy.slug, form.slug);
  assert.equal((await (await request(`/admin/forms/${copy.id}/responses`)).json()).total, 0);
  await request(`/admin/forms/${form.id}`, 'DELETE', {});
  assert.equal((await request(`/admin/forms/${form.id}?permanent=true`, 'DELETE', { confirmation: 'wrong' })).status, 400);
  assert.equal((await request(`/admin/forms/${form.id}?permanent=true`, 'DELETE', { confirmation: form.title })).status, 200);
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, 0);
  assert.equal((await request(`/admin/forms/${form.id}/responses`)).status, 404);
  assert.ok((await (await request('/admin/system')).json()).events.some(event => event.action === 'purgeForm'));
});

test('collection settings, conditions and typed answers are enforced on the server', async t => {
  const { request, submit } = await setup(t);
  let form = await (await request('/admin/forms', 'POST', definition('rules-form', { fields: [field('choice', 'single', true, { options: ['Yes', 'No'] }), field('email', 'email', true, { condition: { fieldId: 'choice', value: 'Yes' } }), field('rating', 'rating', false, { ratingMax: 5 })], settings: { responseLimit: 1, consentText: 'Consent required', listed: true } }))).json();
  assert.equal((await submit(form, { choice: 'Yes', email: 'bad' })).status, 400);
  assert.equal((await submit(form, { choice: 'No', rating: '9' })).status, 400);
  assert.equal((await submit(form, { choice: 'No' }, false, 'false')).status, 400);
  assert.equal((await submit(form, { choice: 'No', email: 'ignored hidden answer', rating: '4' })).status, 201);
  const saved = (await (await request(`/admin/forms/${form.id}/responses`)).json()).items[0];
  assert.equal(saved.answers.email, undefined);
  assert.equal((await submit(form, { choice: 'No' })).status, 410);
  assert.equal((await (await request('/forms')).json()).length, 0);
  form = await (await request(`/admin/forms/${form.id}`, 'PUT', { ...form, settings: { startsAt: '2099-01-01T00:00:00.000Z' } })).json();
  assert.equal((await request('/forms/rules-form')).status, 410);
  assert.equal((await submit(form, { choice: 'No' })).status, 410);
  assert.throws(() => normalizeSettings({ startsAt: '2030-02-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }));
  assert.throws(() => normalizeRules({ type: 'file', fileKinds: ['executable'] }, []));
  assert.throws(() => normalizeRules({ type: 'short', condition: { fieldId: 'missing', value: 'Yes' } }, []));
  assert.equal(visibleFields(form.fields, { choice: 'No' }).length, 2);
  assert.equal(answerError({ type: 'url' }, 'javascript:alert(1)'), 'errors.url');
  assert.equal(answerError({ type: 'date' }, '2026-02-30'), 'errors.date');
  assert.equal(answerError({ type: 'number', min: 2 }, '1'), 'errors.numberRange');
});


test('sessions survive restart, can be revoked, and password rotation invalidates existing sessions', async t => {
  const { request, restart, password } = await setup(t);
  assert.equal((await request('/admin/session')).status, 200);
  await restart();
  assert.equal((await request('/admin/session')).status, 200);
  const other = await request('/admin/login', 'POST', { password }, false);
  assert.equal(other.status, 200);
  assert.equal((await (await request('/admin/sessions')).json()).length, 2);
  await request('/admin/sessions/revoke', 'POST', {});
  assert.equal((await (await request('/admin/sessions')).json()).length, 1);
  assert.equal((await request('/admin/password', 'POST', { currentPassword: 'wrong', newPassword: 'a-new-password-with-enough-length' })).status, 403);
  assert.equal((await request('/admin/password', 'POST', { currentPassword: password, newPassword: 'short' })).status, 400);
  assert.equal((await request('/admin/password', 'POST', { currentPassword: password, newPassword: 'a-new-password-with-enough-length' })).status, 200);
  assert.equal((await request('/admin/session')).status, 401);
  await restart();
  assert.equal((await request('/admin/login', 'POST', { password })).status, 401);
  assert.equal((await request('/admin/login', 'POST', { password: 'a-new-password-with-enough-length' })).status, 200);
});
