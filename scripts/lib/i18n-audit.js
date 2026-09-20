import { parse as parseJS, parseExpression } from '@babel/parser';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';

const hasWords = value => /\p{L}/u.test(value);
const placeholders = value => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m => m[1]).sort();
export function validateCatalogs(catalogs) {
  const errors = [];
  const baseline = catalogs['zh-CN'];
  for (const locale of ['zh-CN', 'en']) {
    const catalog = catalogs[locale];
    if (!catalog || typeof catalog !== 'object') { errors.push(`Missing locale: ${locale}`); continue; }
    for (const key of new Set([...Object.keys(baseline || {}), ...Object.keys(catalog)])) {
      const value = catalog[key], base = baseline?.[key];
      if (typeof value !== 'string' || !value.trim()) { errors.push(`${locale}: missing or empty translation ${key}`); continue; }
      if (typeof base !== 'string') { errors.push(`${locale}: extra translation ${key}`); continue; }
      if (JSON.stringify(placeholders(base)) !== JSON.stringify(placeholders(value))) errors.push(`${locale}: interpolation mismatch for ${key}`);
      if (locale === 'en' && /\p{Script=Han}/u.test(value) && key !== 'language.zhCN') errors.push(`${locale}: untranslated Chinese in ${key}`);
    }
  }
  return errors;
}
function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'errors', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node));
    else if (value && typeof value === 'object') walk(value, visit, node);
  }
}
export function auditSource(file, source, catalog, exceptions = {}) {
  const errors = [], literals = [], dynamic = [];
  const allowed = exceptions[file] || { literals: [], dynamicKeys: [] };
  const report = (offset, message) => errors.push(`${file}:${source.slice(0, offset).split('\n').length}: ${message}`);
  function literal(value, offset, force = false, kind = 'literal') {
    if (!hasWords(value)) return;
    const entry = { kind, value };
    literals.push(entry);
    if (!force && Object.hasOwn(catalog, value)) return;
    if (!force && allowed.literals?.some(item => item.kind === kind && item.value === value && item.reason?.trim())) return;
    report(offset, `Unlocalized ${kind}: ${JSON.stringify(value)}`);
  }
  function javascript(code, offset = 0, expression = false) {
    let ast;
    try { ast = expression ? parseExpression(code, { plugins: ['typescript'] }) : parseJS(code, { sourceType: 'module', plugins: ['typescript'] }); }
    catch (error) { report(offset, `Cannot parse script: ${error.message}`); return; }
    walk(ast, (node, parent) => {
      if (node.type === 'CallExpression' && ['t', 'translate', 'apiError', 'fail'].includes(node.callee?.name)) {
        const index = ['translate', 'apiError', 'fail'].includes(node.callee.name) ? 1 : 0;
        const key = node.arguments[index];
        if (key?.type === 'StringLiteral') {
          if (!Object.hasOwn(catalog, key.value)) report(offset + key.start, `Unknown translation key: ${key.value}`);
          else if (['t','translate'].includes(node.callee.name)) {
            const expected = placeholders(catalog[key.value]);
            const params = node.arguments[index + 1];
            if (!params && expected.length) report(offset + node.start, `Missing interpolation values for ${key.value}`);
            if (params?.type === 'ObjectExpression' && params.properties.every(p => p.type === 'ObjectProperty' && !p.computed)) {
              const supplied = params.properties.map(p => p.key.name || p.key.value);
              for (const name of expected) if (!supplied.includes(name)) report(offset + node.start, `Missing parameter ${name} for ${key.value}`);
            }
          }
        } else if (key) {
          const expression = code.slice(key.start, key.end);
          dynamic.push(expression);
          if (!allowed.dynamicKeys?.some(item => item.expression === expression && item.reason?.trim())) report(offset + key.start, `Unreviewed dynamic translation key: ${expression}`);
        }
      }
      if (node.type === 'StringLiteral') {
        if (['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportAttribute'].includes(parent?.type)) return;
        if ((parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod') && parent.key === node && !parent.computed) return;
        const translationArg = parent?.type === 'CallExpression' && ['t','translate','apiError','fail'].includes(parent.callee?.name) && parent.arguments[parent.callee.name === 't' ? 0 : 1] === node;
        if (!translationArg) literal(node.value, offset + node.start);
      }
      if (node.type === 'TemplateLiteral') literal(node.quasis.map(q => q.value.cooked ?? q.value.raw).join('${}'), offset + node.start, false, 'template');
      if (node.type === 'JSXText' && node.value.trim()) literal(node.value.trim(), offset + node.start, true, 'text');
    });
  }
  function template(code, offset = 0) {
    let ast;
    try { ast = baseParse(code); } catch(error) { report(offset, `Cannot parse template: ${error.message}`); return; }
    function visit(node) {
      if (node.type === 2) { const content = node.content.trim(); if (content && !/^%QUESUWA_[A-Z]+%$/.test(content)) literal(content, offset + node.loc.start.offset, true, 'text'); }
      if (node.type === 5) javascript(node.content.content, offset + node.content.loc.start.offset, true);
      if (node.type === 1) {
        if (node.tag === 'script') {
          const content = node.children.map(c => c.content || '').join('');
          if (content.trim()) javascript(content, offset + (node.children[0]?.loc.start.offset || node.loc.start.offset));
          return;
        }
        for (const prop of node.props) {
          if (prop.type === 6 && prop.value) {
            const visible = ['placeholder','title','alt','aria-label','aria-description','aria-valuetext','label'].includes(prop.name) || (prop.name === 'value' && node.tag === 'input' && node.props.some(p => p.name === 'type' && ['submit','button','reset'].includes(p.value?.content))) || (node.tag === 'meta' && prop.name === 'content' && node.props.some(p=>p.name==='name' && p.value?.content==='description'));
            if (visible && !/^%QUESUWA_[A-Z]+%$/.test(prop.value.content)) literal(prop.value.content, offset + prop.loc.start.offset, true, 'attribute');
          }
          if (prop.type === 7 && prop.exp) {
            let content = prop.exp.content;
            if (prop.name === 'for') content = content.replace(/^[\s\S]*?\s+(?:in|of)\s+/, '');
            javascript(content, offset + prop.exp.loc.start.offset, prop.name !== 'on');
          }
        }
      }
      for (const child of node.children || []) visit(child);
    }
    visit(ast);
  }
  if (file.endsWith('.vue')) {
    const parsed = parseSFC(source);
    for (const error of parsed.errors) report(0, `Invalid Vue SFC: ${error.message || error}`);
    const { descriptor } = parsed;
    for (const script of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) javascript(script.content, script.loc.start.offset);
    if (descriptor.template) template(descriptor.template.content, descriptor.template.loc.start.offset);
    for (const style of descriptor.styles) css(style.content, style.loc.start.offset);
  } else if (/\.[cm]?[jt]sx?$/.test(file)) javascript(source);
  else if (/\.(html|svg)$/.test(file)) template(source);
  else if (file.endsWith('.css')) css(source);
  else if (file.endsWith('.json')) {
    try {
      const inspect = value => { if (typeof value === 'string') literal(value, 0); else if (value && typeof value === 'object') Object.values(value).forEach(inspect); };
      inspect(JSON.parse(source));
    } catch(error) { report(0, `Invalid JSON: ${error.message}`); }
  }
  function css(code, offset) {
    const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of stripped.matchAll(/(?<![\w-])content\s*:\s*([^;}]+)/g)) {
      if (!/^(none|normal|attr\([^)]*\))\s*$/.test(match[1])) literal(match[1].replace(/["']/g, ''), offset + match.index, true, 'CSS content');
    }
  }
  return { errors, literals, dynamic };
}
