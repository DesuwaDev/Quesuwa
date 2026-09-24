import { answerable } from '../../shared/schema.js';
import { formatAnswer } from '../../shared/answers.js';
import { statusKeys } from '../../shared/constants.js';
import { t } from '../i18n.js';
import { parseResponse } from './responses.js';

export function csvCell(value) {
  let text = String(value ?? '');
  // Prevent spreadsheet formula execution for user-provided text.
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const csvLine = values => values.map(csvCell).join(',') + '\r\n';

const fileNames = (response, fieldId, separator) => response.attachments.filter(a => a.fieldId === fieldId).map(a => a.name).join(separator);

// Column layout for one-row-per-response exports: the current definition first,
// then questions that only exist in older snapshots.
export function wideColumns(form, snapshots) {
  const variants = new Map();
  for (const field of [...form.fields, ...snapshots.flatMap(snapshot => snapshot.fields || [])]) {
    if (!answerable(field)) continue;
    const entry = variants.get(field.id) || { field, rows: [] };
    if (field.type === 'matrix') for (const row of field.rows || []) if (!entry.rows.includes(row)) entry.rows.push(row);
    variants.set(field.id, entry);
  }
  const columns = [];
  for (const { field, rows } of variants.values()) {
    const find = response => response.snapshot.fields.find(f => f.id === field.id && f.type === field.type);
    if (field.type === 'matrix') {
      for (const row of rows) {
        columns.push({ header: `${field.label} [${row}]`, value: response => {
          const own = find(response), answer = response.answers[field.id];
          const index = own?.rows?.indexOf(row) ?? -1;
          return index >= 0 && Array.isArray(answer) ? answer[index] || '' : '';
        } });
      }
    } else {
      columns.push({ header: field.label, value: (response, separator) => {
        const own = find(response);
        if (!own) return '';
        return own.type === 'file' ? fileNames(response, own.id, separator) : formatAnswer(own, response.answers[own.id], separator);
      } });
    }
  }
  return columns;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return String(Math.round(ms / 1000));
}

export function streamCsv(db, res, form, filter, long) {
  const separator = t('csv.separator');
  res.write('﻿');
  const rows = () => db.prepare(`SELECT * FROM responses WHERE ${filter.where} ORDER BY created_at DESC`).iterate(...filter.params);
  const status = response => t(statusKeys[response.status] || 'status.pending');
  const starred = response => response.starred ? t('csv.yes') : '';
  if (long) {
    res.write(csvLine([t('csv.id'), t('csv.time'), t('csv.status'), t('csv.title'), t('csv.question'), t('csv.answer'), t('csv.note')]));
    for (const row of rows()) {
      const response = parseResponse(row);
      for (const field of response.snapshot.fields) {
        if (!answerable(field)) continue;
        const value = field.type === 'file' ? fileNames(response, field.id, separator) : formatAnswer(field, response.answers[field.id], separator);
        res.write(csvLine([response.id, response.createdAt, status(response), response.snapshot.title, field.label, value, response.note]));
      }
    }
    return res.end();
  }
  const snapshots = db.prepare(`SELECT DISTINCT snapshot FROM responses WHERE ${filter.where}`).all(...filter.params).map(row => JSON.parse(row.snapshot));
  const columns = wideColumns(form, snapshots);
  res.write(csvLine([t('csv.id'), t('csv.time'), t('csv.status'), t('csv.starred'), t('csv.duration'), t('csv.note'), ...columns.map(column => column.header)]));
  for (const row of rows()) {
    const response = parseResponse(row);
    res.write(csvLine([response.id, response.createdAt, status(response), starred(response), formatDuration(response.durationMs), response.note, ...columns.map(column => column.value(response, separator))]));
  }
  res.end();
}

export function streamJson(db, res, form, filter) {
  res.write('{"form":' + JSON.stringify({ id: form.id, slug: form.slug, title: form.title }) + ',"responses":[');
  let first = true;
  for (const row of db.prepare(`SELECT * FROM responses WHERE ${filter.where} ORDER BY created_at DESC`).iterate(...filter.params)) {
    const response = parseResponse(row);
    const item = {
      id: response.id,
      createdAt: response.createdAt,
      status: response.status,
      starred: response.starred,
      note: response.note,
      durationMs: response.durationMs,
      locale: response.locale,
      formVersion: response.snapshot.version,
      answers: response.snapshot.fields.filter(answerable).map(field => ({
        fieldId: field.id,
        type: field.type,
        label: field.label,
        value: field.type === 'file' ? response.attachments.filter(a => a.fieldId === field.id).map(({ name, mime, size }) => ({ name, mime, size })) : response.answers[field.id] ?? null
      }))
    };
    res.write((first ? '' : ',') + JSON.stringify(item));
    first = false;
  }
  res.end(']}');
}

const safePart = value => String(value).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || '_';

export function zipEntries(db, filter, filePath) {
  const entries = [];
  let bytes = 0;
  for (const row of db.prepare(`SELECT id, snapshot, attachments, created_at FROM responses WHERE ${filter.where} ORDER BY created_at DESC`).iterate(...filter.params)) {
    const attachments = JSON.parse(row.attachments);
    if (!attachments.length) continue;
    const fields = JSON.parse(row.snapshot).fields;
    const used = new Set();
    for (const [index, attachment] of attachments.entries()) {
      const label = fields.find(f => f.id === attachment.fieldId)?.label || attachment.fieldId;
      let name = `${row.id.slice(0, 8).toUpperCase()}/${safePart(label)}/${safePart(attachment.name)}`;
      if (used.has(name)) name = `${row.id.slice(0, 8).toUpperCase()}/${safePart(label)}/${index + 1}-${safePart(attachment.name)}`;
      used.add(name);
      entries.push({ name, path: filePath(attachment.id), date: row.created_at });
      bytes += attachment.size;
    }
  }
  return { entries, bytes };
}
