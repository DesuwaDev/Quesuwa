import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ref, computed } from 'vue';
import { defaultSettings, normalizeRules } from '../src/form-rules.js';

function setup(origin = 'http://localhost') {
  let copiedLink = '';
  const listeners = new Map();
  const entries = [null];
  let position = 0;
  let confirmation = true;
  let mounted;
  const history = {
    replaceState(state) { entries[position] = structuredClone(state); },
    pushState(state) { entries.splice(++position); entries[position] = structuredClone(state); },
    go(delta) {
      const next = position + delta;
      if (next < 0 || next >= entries.length) return;
      position = next;
      listeners.get('popstate')?.({ state: entries[position] });
    },
    back() { this.go(-1); }
  };
  const context = vm.createContext({
    ref, computed, defaultSettings, normalizeRules, crypto, console, transitionView: action => action(),
    onMounted(fn) { mounted = fn; }, onUnmounted() {},
    t: key => key, locale: ref('en'), languageHeaders: () => ({}),
    navigator: { clipboard: { writeText: async value => { copiedLink = value; } } },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async url => ({ ok: true, json: async () => url.endsWith('/forms') ? [] : { ok: true } }),
    window: {
      history, location: { href: `${origin}/admin`, origin },
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: type => listeners.delete(type),
      confirm: () => confirmation
    }
  });
  const source = fs.readFileSync(new URL('../src/Admin.vue', import.meta.url), 'utf8')
    .split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm, '');
  vm.runInContext(source + '\nglobalThis.controls = { create, togglePreview, back, logout, view, draft, preview, formUrl, copyLink };', context);
  return { ...context.controls, copiedLink: () => copiedLink, beforeUnload: event => listeners.get('beforeunload')(event), history, mount: () => mounted(), confirm: value => { confirmation = value; } };
}

test('browser back returns from new questionnaire to admin list and forward restores editor', async () => {
  const app = setup(); await app.mount(); app.create();
  assert.equal(app.view.value, 'editor');
  app.history.back();
  assert.equal(app.view.value, 'forms');
  app.history.go(1);
  assert.equal(app.view.value, 'editor');
  assert.ok(app.draft.value);
});

test('preview back preserves edited draft and cancelled navigation stays in editor', async () => {
  const app = setup(); await app.mount(); app.create();
  app.draft.value.title = 'Unsubmitted draft';
  app.togglePreview(); app.confirm(false); app.history.back();
  assert.equal(app.view.value, 'editor');
  assert.equal(app.preview.value, false);
  assert.equal(app.draft.value.title, 'Unsubmitted draft');
  app.history.back();
  assert.equal(app.view.value, 'editor');
  assert.equal(app.draft.value.title, 'Unsubmitted draft');
  app.confirm(true); app.back();
  assert.equal(app.view.value, 'forms');
});

test('history after logout cannot restore an editor with a cleared draft', async () => {
  const app = setup(); await app.mount(); app.create(); app.togglePreview();
  await app.logout(); app.history.back();
  assert.equal(app.view.value, 'forms');
  assert.equal(app.preview.value, false);
});


test('untouched new questionnaire does not warn; edits warn until reverted', async () => {
  const app = setup(); await app.mount(); app.create();
  let prevented = false;
  const event = { preventDefault() { prevented = true; } };
  app.beforeUnload(event);
  assert.equal(prevented, false);
  assert.equal(event.returnValue, undefined);
  const initial = app.draft.value.title;
  app.draft.value.title = 'Changed title';
  app.beforeUnload(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, '');
  app.draft.value.title = initial;
  prevented = false;
  app.beforeUnload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  app.confirm(false);
  app.back();
  assert.equal(app.view.value, 'forms');
});


test('share URLs follow the browser public domain and port behind a reverse proxy', async () => {
  for (const origin of ['https://survey.example.test', 'https://feedback.example.test:8443']) {
    const app = setup(origin); await app.mount(); app.create();
    app.draft.value.slug = 'public-survey';
    assert.equal(app.formUrl.value, origin + '/f/public-survey');
    await app.copyLink(app.draft.value.slug);
    assert.equal(app.copiedLink(), app.formUrl.value);
  }
});
