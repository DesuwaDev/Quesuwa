import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const password = 'test-admin-password-123456';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('custom questionnaires: authentication, uploads, snapshots, export and persistence', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-test-'));
  let instance = createApp({ dataDir, password, seed: false });
  let server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let base = `http://127.0.0.1:${server.address().port}`, cookie = '';
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  async function request(url, method = 'GET', body, opts = {}) {
    const res = await fetch(base + '/api' + url, { method, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers }, body: body ? JSON.stringify(body) : undefined });
    return res;
  }
  async function submit(form, { answers = { text: '发送消息后没有回复', multi: ['A'] }, version = form.version, files = [] } = {}) {
    const body = new FormData(); body.append('answers', JSON.stringify(answers)); body.append('version', String(version));
    for (const f of files) body.append(f.field || 'files', new Blob([f.data], { type: f.type || 'image/png' }), f.name);
    return fetch(base + `/api/forms/${form.slug}/responses`, { method: 'POST', headers: { Origin: base }, body });
  }
  assert.equal((await request('/admin/forms')).status, 401);
  assert.equal((await request('/admin/login', 'POST', { password }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/admin/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await request('/admin/login', 'POST', { password });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const definition = { slug: 'test-survey', title: '自定义问卷', description: 'test', thanks: '已收到', state: 'draft', fields: [
    { id: 'text', type: 'long', label: '问题描述', required: true, description: '' },
    { id: 'multi', type: 'multi', label: '多选问题', required: true, options: ['A', 'B'] },
    { id: 'files', type: 'file', label: '附件', required: true },
  ] };
  let res = await request('/admin/forms', 'POST', definition); assert.equal(res.status, 201); let form = await res.json();
  assert.equal((await request('/forms/test-survey')).status, 404);
  assert.equal((await request('/forms')).status, 200);
  assert.deepEqual(await (await request('/forms')).json(), []);
  assert.equal((await request('/admin/forms', 'POST', definition)).status, 409);
  res = await request(`/admin/forms/${form.id}`, 'PUT', { ...form, state: 'published' }); assert.equal(res.status, 200); form = await res.json();
  assert.equal((await request('/forms/test-survey')).status, 200);
  assert.equal((await request(`/admin/forms/${form.id}`, 'PUT', { ...form, version: 0 })).status, 409);
  assert.equal((await submit(form, { answers: {} })).status, 400);
  assert.equal((await submit(form, { answers: { text: 'ok', multi: ['not-valid'] } })).status, 400);
  assert.equal((await submit(form, { version: 1 })).status, 409);
  assert.equal((await submit(form, { files: [{ name: 'fake.png', data: '<svg onload="alert(1)"></svg>' }] })).status, 400);
  assert.equal((await submit(form)).status, 400);
  assert.equal((await submit(form, { files: [{ name: 'too-large.png', data: Buffer.alloc(10 * 1024 * 1024 + 1) }] })).status, 400);
  assert.equal((await submit(form, { files: [{ name: 'truncated.png', data: png.subarray(0, 9) }] })).status, 400);
  assert.equal((await submit(form, { files: Array.from({ length: 4 }, () => ({ name: 'screenshot.png', data: png })) })).status, 400);
  assert.equal((await submit(form, { files: [{ field: 'unknown', name: 'screenshot.png', data: png }] })).status, 400);
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, 0);
  res = await submit(form, { answers: { text: '=FORMULA()', multi: ['A', 'B'] }, files: [{ name: '验收截图.png', data: png }, { name: 'error.log', type: 'text/plain', data: '错误日志: request failed' }] });
  assert.equal(res.status, 201); const submitted = await res.json();
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, 2);
  const records = await (await request(`/admin/forms/${form.id}/responses`)).json(); assert.equal(records.total, 1);
  const record = records.items[0]; assert.equal(record.id, submitted.id); assert.equal(record.attachments.length, 2);
  assert.equal(record.attachments[0].name, '验收截图.png');
  const fileUrl = `/admin/responses/${record.id}/files/${record.attachments[0].id}`;
  res = await fetch(base + '/api' + fileUrl); assert.equal(res.status, 401);
  res = await request(fileUrl); assert.equal(res.status, 200); assert.deepEqual(Buffer.from(await res.arrayBuffer()), png); assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.equal((await request(`/admin/responses/${record.id}`, 'PATCH', { status: '排查中', note: '内部备注' }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(`/admin/responses/${record.id}`, 'PATCH', { status: '排查中', note: '内部备注' })).status, 200);
  const updated = { ...form, fields: form.fields.map(f => ({ ...f, label: '修改后的题目' })) };
  res = await request(`/admin/forms/${form.id}`, 'PUT', updated); assert.equal(res.status, 200); form = await res.json();
  const saved = (await (await request(`/admin/forms/${form.id}/responses?status=${encodeURIComponent('排查中')}`)).json()).items[0];
  assert.equal(saved.snapshot.fields[0].label, '问题描述'); assert.equal(saved.note, '内部备注');
  res = await request(`/admin/forms/${form.id}/export`); assert.equal(res.status, 200);
  const csv = await res.text(); assert.match(csv, /问题描述/); assert.match(csv, /'=FORMULA\(\)/);
  res = await request(`/admin/forms/${form.id}`, 'PUT', { ...form, state: 'closed' }); assert.equal(res.status, 200);
  assert.equal((await request('/forms/test-survey')).status, 410); assert.equal((await submit(form)).status, 404);
  assert.equal((await request('/admin/logout', 'POST', {})).status, 200); assert.equal((await request('/admin/forms')).status, 401);
  await new Promise(resolve => server.close(resolve)); instance.close();
  instance = createApp({ dataDir, password, seed: false }); server = instance.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; cookie = '';
  res = await request('/admin/login', 'POST', { password }); cookie = res.headers.get('set-cookie').split(';')[0];
  const persisted = await (await request(`/admin/forms/${form.id}/responses`)).json(); assert.equal(persisted.total, 1); assert.equal(persisted.items[0].note, '内部备注');
});
