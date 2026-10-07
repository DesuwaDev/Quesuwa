// Browser checks against the built app: sign-in with two-step verification, a public submission,
// and every admin page at phone and desktop sizes without script errors or horizontal overflow.
// Requires `npm run build` and a local Chrome/Chromium (CHROME_PATH overrides detection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/app.js';
import { hotp } from '../../server/lib/totp.js';

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const chrome = candidates.find(file => file && fs.existsSync(file));
const built = fs.existsSync(new URL('../../dist/index.html', import.meta.url));
// CI sets REQUIRE_BROWSER so a missing browser fails instead of silently skipping.
if (process.env.REQUIRE_BROWSER && (!chrome || !built)) throw new Error(`Browser tests need Chrome (${chrome || 'not found'}) and a build (${built ? 'present' : 'missing'}).`);

test('admin and public pages work in a real browser', { skip: !chrome ? 'Chrome not found (set CHROME_PATH)' : !built ? 'run npm run build first' : false, timeout: 180_000 }, async t => {
  const { default: puppeteer } = await import('puppeteer-core');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-e2e-'));
  const password = 'browser-owner-password-1';
  const instance = createApp({ dataDir, password, defaultLocale: 'en' });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    instance.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const errors = [];
  async function open(context, viewport) {
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('quesuwa.locale', 'en'); } catch { /* about:blank has no storage. */ } });
    page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/status of 40[13]|ERR_INTERNET_DISCONNECTED/.test(message.text())) errors.push(`${page.url()}: ${message.text()}`); });
    await page.setViewport(viewport);
    return page;
  }
  // Pages with live updates always keep one long-poll request open.
  const settle = page => page.waitForNetworkIdle({ idleTime: 300, timeout: 15_000, concurrency: 1 }).catch(() => {});
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const code = (secret, offset = 0) => hotp(secret, Math.floor(Date.now() / 30_000) + offset);
  const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const desktop = { width: 1366, height: 900 };

  // Password sign-in through the form.
  const context = await browser.createBrowserContext();
  const page = await open(context, desktop);
  await page.goto(base + '/admin', { waitUntil: 'networkidle0' });
  await page.type('input[name=username]', 'admin');
  await page.type('input[name=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.admin-sidebar');

  // A published questionnaire answered from a phone.
  // A published bug report opened from a site's announcement link, answered from a phone.
  const definition = {
    title: 'Browser check', slug: 'browser-check', state: 'published', settings: { collectEnvironment: true },
    fields: [
      { id: 'site', type: 'single', label: 'Which site', options: ['Main site', 'Mirror site'], required: true, prefillKey: 'site' },
      { id: 'q', type: 'short', label: 'Your name', required: true },
      { id: 'shot', type: 'file', label: 'Screenshot', fileKinds: ['image'] }
    ]
  };
  const form = await page.evaluate(async body => (await fetch('/api/admin/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(), definition);
  const visitor = await open(await browser.createBrowserContext(), phone);
  await visitor.goto(base + '/f/browser-check?site=mirror%20site', { waitUntil: 'networkidle0' });
  assert.equal(await visitor.$eval('input[type=radio]:checked', input => input.value), 'Mirror site', 'site comes from the link');
  assert.ok(await visitor.$('[data-field="site"] .prefill-note'), 'prefilled answer asks for confirmation');
  assert.ok(await visitor.$('.environment-note'), 'diagnostics are disclosed before sending');
  await visitor.type('input.input', 'Ada');
  // Pasting an image anywhere attaches it to the screenshot question.
  await visitor.evaluate(async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([png], 'image.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.match(await visitor.$eval('.file-name', node => node.textContent), /^screenshot-\d{14}\.png/);
  await visitor.click('button.submit-button');
  await visitor.waitForSelector('.success-panel');
  const saved = await page.evaluate(async id => (await (await fetch(`/api/admin/forms/${id}/responses`)).json()), form.id);
  const response = (saved.items || saved)[0];
  assert.equal(response.answers.site, 'Mirror site');
  assert.equal(response.attachments.length, 1);
  assert.equal(response.environment.viewport, '390x844');

  // Ticket conversations update live on both sides without reloading.
  const support = await page.evaluate(async () => (await fetch('/api/admin/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Support', slug: 'support', state: 'published', settings: { ticketMode: true }, fields: [{ id: 'q', type: 'long', label: 'Issue' }] }) })).json());
  const ticket = await visitor.evaluate(async version => {
    const body = new FormData();
    body.set('answers', JSON.stringify({ q: 'Live check' }));
    body.set('version', String(version));
    return (await (await fetch('/api/forms/support/responses', { method: 'POST', body })).json()).ticket;
  }, support.version);
  await visitor.goto(`${base}/t/${ticket.id}#k=${ticket.key}`, { waitUntil: 'networkidle2' });
  await visitor.waitForSelector('.ticket-composer');
  await page.goto(`${base}/admin/forms/${support.id}/responses?r=${ticket.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.ticket-admin');
  await page.evaluate(async id => (await fetch(`/api/admin/responses/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Staff says hi' }) })).json(), ticket.id);
  await visitor.waitForFunction(() => [...document.querySelectorAll('.bubble.from-staff p')].some(node => node.textContent === 'Staff says hi'), { timeout: 8000 });
  await visitor.type('.ticket-composer textarea', 'Respondent answers');
  await visitor.click('.ticket-composer button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('.ticket-admin .bubble p')].some(node => node.textContent === 'Respondent answers'), { timeout: 8000 });
  // A phone that drops off the network shows a hint and catches up by itself once back online.
  await visitor.setOfflineMode(true);
  await visitor.waitForSelector('.live-offline', { timeout: 8000 });
  await page.evaluate(async id => (await fetch(`/api/admin/responses/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Sent while you were away' }) })).json(), ticket.id);
  await visitor.setOfflineMode(false);
  await visitor.waitForFunction(() => [...document.querySelectorAll('.bubble.from-staff p')].some(node => node.textContent === 'Sent while you were away'), { timeout: 10000 });
  await visitor.waitForFunction(() => !document.querySelector('.live-offline'), { timeout: 10000 });

  // Markdown, pasted screenshots, read receipts, and silent staff edits and retractions.
  await page.evaluate(async id => (await fetch(`/api/admin/responses/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Try **this** guide: [docs](https://example.com/docs)' }) })).json(), ticket.id);
  await visitor.waitForFunction(() => [...document.querySelectorAll('.bubble.from-staff .rich-text strong')].some(node => node.textContent === 'this'), { timeout: 8000 });
  assert.equal(await visitor.$eval('.bubble.from-staff:last-of-type .rich-text a', link => link.getAttribute('href') + '|' + link.rel), 'https://example.com/docs|noopener noreferrer nofollow');
  await visitor.bringToFront();
  await page.waitForFunction(() => [...document.querySelectorAll('.ticket-admin .read-receipt.read')].length >= 1, { timeout: 10000 });
  await visitor.focus('.ticket-composer textarea');
  await visitor.evaluate(() => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([png], 'image.png', { type: 'image/png' }));
    document.querySelector('.ticket-composer textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await visitor.waitForSelector('.composer-file-list li');
  await visitor.click('.ticket-composer button[type=submit]');
  await visitor.waitForSelector('.bubble.from-me .message-image img', { timeout: 8000 });
  await page.waitForSelector('.ticket-admin .message-image img', { timeout: 8000 });

  // Staff correct the respondent's message from the message menu.
  const target = await page.$$eval('.ticket-admin .bubble.from-staff', bubbles => bubbles.findIndex(bubble => bubble.textContent.includes('Respondent answers')));
  const bubbles = await page.$$('.ticket-admin .bubble.from-staff');
  await (await bubbles[target].$('.bubble-menu .menu-trigger')).click();
  await page.click('.menu-popover .menu-item');
  await page.waitForSelector('.bubble-edit textarea');
  await page.$eval('.bubble-edit textarea', area => { area.value = ''; area.dispatchEvent(new Event('input')); });
  await page.type('.bubble-edit textarea', 'Respondent answers (corrected)');
  await page.click('.bubble-edit button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('.ticket-admin .bubble-tag')].some(tag => tag.textContent.trim() === 'Edited'), { timeout: 8000 });
  await visitor.waitForFunction(() => [...document.querySelectorAll('.bubble.from-me')].some(bubble => bubble.textContent.includes('Respondent answers (corrected)')), { timeout: 8000 });
  assert.equal(await visitor.$('.bubble-tag'), null, 'the respondent sees no edit marker');

  // Retracting a staff message removes it from the respondent's page.
  const staffIndex = await page.$$eval('.ticket-admin .bubble.from-me', items => items.findIndex(item => item.textContent.includes('Staff says hi')));
  await (await (await page.$$('.ticket-admin .bubble.from-me'))[staffIndex].$('.bubble-menu .menu-trigger')).click();
  await page.click('.menu-popover .menu-item.danger');
  await page.waitForSelector('.modal-actions .button.danger');
  await page.click('.modal-actions .button.danger');
  await page.waitForSelector('.ticket-admin .bubble.retracted');
  await visitor.waitForFunction(() => ![...document.querySelectorAll('.bubble.from-staff')].some(bubble => bubble.textContent.includes('Staff says hi')), { timeout: 8000 });
  assert.ok(await overflow(visitor) <= 1, 'public form fits a phone screen');

  // Built-in Cap: the real widget solves a proof-of-work challenge under the site's CSP.
  await page.evaluate(async () => {
    await (await fetch('/api/admin/system/captcha', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'cap', providers: { cap: { mode: 'builtin', strength: 'low' } } }) })).json();
    await (await fetch('/api/admin/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Guarded', slug: 'guarded', state: 'published', settings: { captcha: true }, fields: [{ id: 'q', type: 'short', label: 'Name' }] }) })).json();
  });
  const guarded = await open(await browser.createBrowserContext(), phone);
  await guarded.goto(base + '/f/guarded', { waitUntil: 'networkidle0' });
  await guarded.type('input.input', 'Bot or not');
  await guarded.click('button.submit-button');
  await guarded.waitForSelector('.form-error');
  await guarded.waitForSelector('cap-widget');
  await guarded.click('cap-widget');
  await guarded.waitForFunction(() => document.querySelector('cap-widget')?.shadowRoot?.querySelector('[data-state="done"], .done') || document.querySelector('cap-widget input[name="captcha-token"]')?.value, { timeout: 30000 });
  await guarded.click('button.submit-button');
  await guarded.waitForSelector('.success-panel', { timeout: 15000 });

  // Enrol two-step verification from the account page.
  await page.goto(base + '/admin/account', { waitUntil: 'networkidle0' });
  await page.click('::-p-text(Set up two-step verification)');
  await page.waitForSelector('.totp-qr svg');
  const secret = (await page.$eval('.secret-code', node => node.textContent)).replace(/\s/g, '');
  await page.type('.totp-setup input', code(secret));
  await page.click('.totp-setup button[type=submit]');
  await page.waitForSelector('.recovery-codes li');
  assert.equal(await page.$$eval('.recovery-codes li', items => items.length), 10);

  // A fresh browser must pass the second step.
  const second = await open(await browser.createBrowserContext(), phone);
  await second.goto(base + '/admin', { waitUntil: 'networkidle0' });
  await second.type('input[name=username]', 'admin');
  await second.type('input[name=password]', password);
  await second.click('button[type=submit]');
  await second.waitForSelector('input[name=otp]');
  await second.type('input[name=otp]', code(secret, 1));
  await second.click('button[type=submit]');
  await second.waitForSelector('.admin-main');

  // Every admin page renders at both sizes.
  const pages = ['/admin', '/admin/forms', `/admin/forms/${form.id}/edit`, `/admin/forms/${form.id}/settings`, `/admin/forms/${form.id}/share`, `/admin/forms/${form.id}/responses`, `/admin/forms/${form.id}/analytics`, '/admin/notifications', '/admin/users', '/admin/system', '/admin/system?tab=settings', '/admin/system?tab=backup', '/admin/system?tab=captcha', '/admin/system?tab=activity', '/admin/account'];
  for (const [tab, label] of [[second, 'phone'], [page, 'desktop']]) {
    for (const url of pages) {
      await tab.goto(base + url, { waitUntil: 'domcontentloaded' });
      await settle(tab);
      assert.ok(await tab.$('.page, .workspace'), `${url} renders (${label})`);
      assert.ok(await overflow(tab) <= 1, `${url} has no horizontal scroll (${label})`);
    }
  }
  assert.deepEqual(errors, []);
});
