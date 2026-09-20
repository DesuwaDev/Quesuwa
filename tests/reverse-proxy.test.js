import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

test('production reverse proxy uses public origin without redirects to its upstream address', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-proxy-'));
  const password = 'proxy-test-password-long-enough';
  const publicOrigin = 'https://survey.example.test:8443';
  const instance = createApp({ dataDir, password, production: true, publicOrigin, trustProxyHops: 1 });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const upstream = `http://127.0.0.1:${server.address().port}`;
  // The proxy connects over HTTP and retains its upstream Host; browser origin is HTTPS.
  const headers = { Origin: publicOrigin, 'X-Forwarded-Host': 'survey.example.test:8443', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.25', 'Content-Type': 'application/json' };
  const request = (url, method = 'GET', body, extra = {}) => fetch(upstream + url, { method, redirect: 'manual', headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = await request('/api/admin/login', 'POST', { password });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('location'), null);
  assert.match(login.headers.get('set-cookie'), /Secure/);
  assert.doesNotMatch(login.headers.get('set-cookie'), /Domain=/i);
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const created = await request('/api/admin/forms', 'POST', { slug: 'proxy-survey', title: 'Proxy survey', state: 'published', fields: [{ id: 'answer', label: 'Answer', type: 'short', required: false }] }, { Cookie });
  assert.equal(created.status, 201);
  for (const url of ['/api/admin/session', '/api/forms/proxy-survey', '/api/health']) {
    const response = await request(url, 'GET', undefined, { Cookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.doesNotMatch(await response.text(), /(?:0\.0\.0\.0|127\.0\.0\.1):3100/);
  }
  assert.equal((await request('/api/admin/login', 'POST', { password }, { Origin: 'http://127.0.0.1:3100' })).status, 403);
});
