import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDefinition } from '../shared/schema.js';
import { estimateSeconds } from '../shared/answers.js';

const define = (slug, fields) => normalizeDefinition({ title: slug, slug, state: 'draft', fields }).fields;

test('the time estimate follows one branch, not every branch added up', () => {
  const branch = value => ({ id: `detail${value}`, type: 'long', label: 'Tell us more', required: true, logic: { match: 'all', rules: [{ fieldId: 'topic', op: 'equals', value }] } });
  const fields = define('branches', [{ id: 'topic', type: 'single', label: 'Topic', required: true, options: ['A', 'B', 'C', 'D'] }, ...['A', 'B', 'C', 'D'].map(branch)]);
  const typical = estimateSeconds(fields, {});
  const chosen = estimateSeconds(fields, { topic: 'A' });
  const everything = estimateSeconds(fields.map(field => ({ ...field, logic: null })), {});
  assert.ok(Math.abs(typical - chosen) < 5, `an open choice counts as one branch (${typical} vs ${chosen})`);
  assert.ok(everything > chosen * 3, `four branches shown at once take about four times as long (${everything} vs ${chosen})`);
  assert.equal(estimateSeconds(fields, {}), typical, 'the same answers give the same estimate');

  const optional = define('optional', [{ id: 'note', type: 'long', label: 'Note', required: false }]);
  assert.ok(estimateSeconds(optional, {}) < estimateSeconds(optional.map(field => ({ ...field, required: true })), {}), 'optional questions count for less');
});
