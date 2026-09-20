import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSource, validateCatalogs } from './lib/i18n-audit.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
const catalogs = Object.fromEntries(['zh-CN', 'en'].map(locale => [locale, JSON.parse(read(`i18n/locales/${locale}.json`))]));
const exceptions = JSON.parse(read('i18n/technical-literals.json'));
const files = [];
function collect(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) collect(file);
    else if (/\.(vue|[cm]?[jt]sx?|html|svg|css|json)$/.test(file)) files.push(file);
  }
}
for (const dir of ['src', 'server', 'public']) collect(dir);
files.push('scripts/reset-password.js', 'scripts/setup.js', 'i18n/core.js', 'index.html', 'vite.config.js');
const errors = validateCatalogs(catalogs);
for (const file of files) {
  const result = auditSource(file, read(file), catalogs['zh-CN'], exceptions);
  errors.push(...result.errors);
  for (const entry of exceptions[file]?.literals || []) {
    if (!entry.reason?.trim()) errors.push(`${file}: technical exception needs a reason`);
    if (!result.literals.some(item => item.kind === entry.kind && item.value === entry.value)) errors.push(`${file}: stale technical literal ${JSON.stringify(entry.value)}`);
  }
  for (const entry of exceptions[file]?.dynamicKeys || []) {
    if (!entry.reason?.trim()) errors.push(`${file}: dynamic translation key needs a reason`);
    if (!result.dynamic.includes(entry.expression)) errors.push(`${file}: stale dynamic key exception ${entry.expression}`);
  }
}
for (const file of Object.keys(exceptions)) if (!files.includes(file)) errors.push(`Stale technical exception file: ${file}`);
// Duplicate keys are lost by JSON.parse, so also validate the source property names.
for (const locale of ['zh-CN', 'en']) {
  const source = read(`i18n/locales/${locale}.json`), seen = new Set();
  for (const match of source.matchAll(/^\s*"([^"\\]+)"\s*:/gm)) {
    if (seen.has(match[1])) errors.push(`${locale}: duplicate key ${match[1]}`);
    seen.add(match[1]);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`i18n gate passed: ${files.length} runtime files, ${Object.keys(catalogs['zh-CN']).length} matching translations per locale.`);
