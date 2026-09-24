import { answerable } from '../../shared/schema.js';
import { isAnswered } from '../../shared/answers.js';
import { statuses } from '../../shared/constants.js';

const median = sorted => !sorted.length ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
const round = value => value === null ? null : Math.round(value * 100) / 100;

export function dayKey(iso, tzOffset) {
  return new Date(Date.parse(iso) - tzOffset * 60000).toISOString().slice(0, 10);
}

// Fills gaps so charts receive a continuous daily series.
export function daySeries(counts, from, to) {
  const series = [];
  if (!from || !to) return series;
  const cursor = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
  while (cursor <= end && series.length < 1100) {
    const key = cursor.toISOString().slice(0, 10);
    series.push({ date: key, count: counts.get(key) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

export const parseOffset = value => {
  const offset = Number.parseInt(value, 10);
  return Number.isInteger(offset) && Math.abs(offset) <= 840 ? offset : 0;
};

function accumulator(field) {
  return { id: field.id, type: field.type, label: field.label, labels: new Set([field.label]), reach: 0, answered: 0,
    options: new Map((field.options || []).map(option => [option, 0])), other: 0, otherSamples: [], values: [],
    rows: [...(field.rows || [])], columns: [...(field.columns || [])], cells: new Map(), ranks: new Map(), samples: [], files: 0, fileResponses: 0,
    scale: field.type === 'rating' ? [1, field.ratingMax || 5] : field.type === 'scale' ? [field.scaleMin ?? 1, field.scaleMax || 5] : field.type === 'nps' ? [0, 10] : null };
}

function add(stats, field, value, response) {
  stats.reach++;
  for (const option of field.options || []) if (!stats.options.has(option)) stats.options.set(option, 0);
  if (field.type === 'file') {
    const count = response.attachments.filter(a => a.fieldId === field.id).length;
    if (count) { stats.answered++; stats.fileResponses++; stats.files += count; }
    return;
  }
  if (!isAnswered(field, value)) return;
  stats.answered++;
  switch (field.type) {
    case 'single': case 'select': case 'multi':
      for (const item of Array.isArray(value) ? value : [value]) {
        if ((field.options || []).includes(item)) stats.options.set(item, (stats.options.get(item) || 0) + 1);
        else { stats.other++; if (stats.otherSamples.length < 20) stats.otherSamples.push(item); }
      }
      break;
    case 'number': case 'rating': case 'scale': case 'nps': {
      const number = Number(value);
      if (Number.isFinite(number)) stats.values.push(number);
      break;
    }
    case 'matrix':
      field.rows.forEach((row, index) => {
        const column = value[index];
        if (!column) return;
        if (!stats.rows.includes(row)) stats.rows.push(row);
        if (!stats.columns.includes(column)) stats.columns.push(column);
        const key = row + '\u0000' + column;
        stats.cells.set(key, (stats.cells.get(key) || 0) + 1);
      });
      break;
    case 'ranking':
      value.forEach((option, index) => {
        const entry = stats.ranks.get(option) || { sum: 0, count: 0 };
        entry.sum += index + 1;
        entry.count++;
        stats.ranks.set(option, entry);
      });
      break;
    default:
      if (stats.samples.length < 12) stats.samples.push({ value: String(value).slice(0, 500), createdAt: response.createdAt, responseId: response.id });
  }
}

function finish(stats) {
  const result = { id: stats.id, type: stats.type, label: stats.label, relabeled: stats.labels.size > 1, reach: stats.reach, answered: stats.answered };
  if (['single', 'select', 'multi'].includes(stats.type)) {
    result.options = [...stats.options].map(([label, count]) => ({ label, count }));
    result.other = stats.other;
    result.otherSamples = stats.otherSamples;
  }
  if (['number', 'rating', 'scale', 'nps'].includes(stats.type)) {
    const sorted = [...stats.values].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    result.numeric = { count: sorted.length, avg: sorted.length ? round(sum / sorted.length) : null, median: round(median(sorted)), min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
    if (stats.scale) {
      const [low, high] = [Math.min(stats.scale[0], sorted[0] ?? stats.scale[0]), Math.max(stats.scale[1], sorted.at(-1) ?? stats.scale[1])];
      result.distribution = [];
      for (let value = low; value <= high && result.distribution.length <= 11; value++) result.distribution.push({ value, count: sorted.filter(item => item === value).length });
    }
    if (stats.type === 'nps') {
      const promoters = sorted.filter(value => value >= 9).length, detractors = sorted.filter(value => value <= 6).length;
      result.nps = { promoters, passives: sorted.length - promoters - detractors, detractors, score: sorted.length ? Math.round(((promoters - detractors) / sorted.length) * 100) : null };
    }
  }
  if (stats.type === 'matrix') result.matrix = { rows: stats.rows, columns: stats.columns, counts: stats.rows.map(row => stats.columns.map(column => stats.cells.get(row + '\u0000' + column) || 0)) };
  if (stats.type === 'ranking') result.ranking = [...stats.ranks].map(([label, entry]) => ({ label, average: round(entry.sum / entry.count), count: entry.count })).sort((a, b) => a.average - b.average);
  if (stats.type === 'file') result.files = { responses: stats.fileResponses, files: stats.files };
  if (['short', 'long', 'email', 'phone', 'url', 'date', 'time'].includes(stats.type)) result.samples = stats.samples;
  return result;
}

export function computeStatistics(db, form, filter, tzOffset) {
  const fields = new Map();
  const order = [];
  const register = field => {
    const key = field.id + ':' + field.type;
    if (!fields.has(key)) { fields.set(key, accumulator(field)); order.push(key); }
    return fields.get(key);
  };
  for (const field of form.fields) if (answerable(field)) register(field);
  const byStatus = Object.fromEntries(statuses.map(status => [status, 0]));
  const days = new Map(), durations = [];
  let total = 0, starred = 0, first = null, last = null;
  for (const row of db.prepare(`SELECT id, answers, snapshot, attachments, created_at, status, starred, duration_ms FROM responses WHERE ${filter.where} ORDER BY created_at DESC`).iterate(...filter.params)) {
    total++;
    if (row.starred) starred++;
    if (Object.hasOwn(byStatus, row.status)) byStatus[row.status]++;
    const day = dayKey(row.created_at, tzOffset);
    days.set(day, (days.get(day) || 0) + 1);
    last ??= day;
    first = day;
    if (row.duration_ms > 0) durations.push(row.duration_ms);
    const response = { id: row.id, createdAt: row.created_at, attachments: JSON.parse(row.attachments) };
    const answers = JSON.parse(row.answers);
    for (const field of JSON.parse(row.snapshot).fields) {
      if (!answerable(field)) continue;
      const stats = register(field);
      if (!stats.labels.has(field.label)) stats.labels.add(field.label);
      add(stats, field, answers[field.id], response);
    }
  }
  durations.sort((a, b) => a - b);
  return {
    total,
    starred,
    byStatus,
    days: daySeries(days, first, last),
    duration: { count: durations.length, avg: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, median: durations.length ? Math.round(median(durations)) : null },
    fields: order.map(key => finish(fields.get(key)))
  };
}
