import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, negotiateLocale, normalizeLocale, translate } from '../i18n/core.js';
import { auditSource, validateCatalogs } from '../scripts/lib/i18n-audit.js';

test('locale negotiation respects quality, regional tags and unsupported languages', () => {
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('zh_TW'), 'zh-CN');
  assert.equal(negotiateLocale('fr, en-GB;q=0.8, zh;q=0.4'), 'en');
  assert.equal(negotiateLocale('en;q=0, zh;q=0.8'), 'zh-CN');
  assert.equal(negotiateLocale('de, fr;q=0.5'), 'zh-CN');
  assert.equal(negotiateLocale('invalid', 'en'), 'en');
});

test('catalogs agree and translation uses plain text interpolation', () => {
  assert.deepEqual(validateCatalogs(catalogs), []);
  assert.equal(translate('en', 'form.progress', { completed: 1, required: 2 }), 'Required questions completed: 1 / 2');
  assert.equal(translate('en', 'form.removeFile', { name: '<img onerror=alert(1)>' }), 'Remove <img onerror=alert(1)>');
  assert.throws(() => translate('en', 'missing.key'), /Unknown translation/);
  assert.throws(() => translate('en', 'form.progress'), /Missing translation/);
  const broken = structuredClone(catalogs);
  delete broken.en['form.submit'];
  broken.en['form.progress'] = 'Completed {wrong}';
  assert.ok(validateCatalogs(broken).some(x => x.includes('form.submit')));
  assert.ok(validateCatalogs(broken).some(x => x.includes('interpolation mismatch')));
});

test('strict gate rejects Chinese and English copy in runtime code and templates', () => {
  const badSources = [
    ['src/Test.vue', '<template><button>Save</button></template>'],
    ['src/Test.vue', '<template><input placeholder="Name" /></template>'],
    ['src/Test.vue', '<template><button :title="\'Edit\'">+</button></template>'],
    ['src/Test.vue', '<template><p>{{ ok ? "Success" : "Failure" }}</p></template>'],
    ['src/Test.vue', '<script setup>const label = "保存";</script>'],
    ['src/Test.vue', '<script setup>const label = "Save";</script>'],
    ['src/Test.vue', '<script setup>const label = `Hello ${name}`;</script>'],
    ['src/new.js', 'const message = "\\u4f60\\u597d";'],
    ['server/new.js', 'throw new Error("Request failed");'],
    ['server/new.js', 'res.json({ error: "Invalid" });'],
    ['src/new.css', '.label::after { content: "Submit"; }'],
    ['src/New.vue', '<template><p>{{ t("does.not.exist") }}</p></template>'],
    ['src/New.vue', '<template><p>{{ t("form.progress", { completed: 1 }) }}</p></template>'],
    ['src/New.vue', '<template><p>{{ t(unreviewed) }}</p></template>'],
    ['index.html', '<html><head><title>Survey</title></head></html>'],
    ['public/new.svg', '<svg><text>Welcome</text></svg>'],
  ];
  for (const [file, source] of badSources) assert.ok(auditSource(file, source, catalogs['zh-CN']).errors.length, source);
  assert.deepEqual(auditSource('src/Test.vue', '<template><button>{{ t("form.submit") }}</button><p>{{ field.label }}</p></template>', catalogs['zh-CN']).errors, []);
  assert.deepEqual(auditSource('src/new.css', '.row { justify-content: center; }', catalogs['zh-CN']).errors, []);
});

test('technical exceptions require exact file, value, kind and a reason', () => {
  const exceptions = { 'server/test.js': { literals: [{ kind: 'literal', value: '/api', reason: 'API route prefix' }] } };
  assert.deepEqual(auditSource('server/test.js', 'const route="/api";', catalogs['zh-CN'], exceptions).errors, []);
  assert.ok(auditSource('server/other.js', 'const route="/api";', catalogs['zh-CN'], exceptions).errors.length);
  assert.ok(auditSource('server/test.js', 'const route="/other";', catalogs['zh-CN'], exceptions).errors.length);
  exceptions['server/test.js'].literals[0].reason = '';
  assert.ok(auditSource('server/test.js', 'const route="/api";', catalogs['zh-CN'], exceptions).errors.length);
});
