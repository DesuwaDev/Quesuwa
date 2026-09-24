import { statuses } from '../../shared/constants.js';
import { answerable } from '../../shared/schema.js';
import { formatAnswer } from '../../shared/answers.js';

export const parseResponse = row => ({
  id: row.id,
  formId: row.form_id,
  snapshot: JSON.parse(row.snapshot),
  answers: JSON.parse(row.answers),
  attachments: JSON.parse(row.attachments),
  createdAt: row.created_at,
  status: row.status,
  note: row.note,
  starred: Boolean(row.starred),
  durationMs: row.duration_ms ?? null,
  locale: row.locale || '',
  deletedAt: row.deleted_at ?? null,
  ticket: Boolean(row.access_hash),
  unread: Boolean(row.unread),
  lastActivityAt: row.last_activity_at || row.created_at,
  ...(row.message_count !== undefined ? { messageCount: row.message_count } : {})
});

const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(value) && Number.isFinite(Date.parse(value));

// Builds the shared WHERE clause for listing, statistics and exports.
export function responseFilter(formId, query = {}) {
  const clauses = ['form_id=?'], params = [formId];
  clauses.push(query.trash === 'true' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
  if (statuses.includes(query.status)) { clauses.push('status=?'); params.push(query.status); }
  if (query.starred === 'true') clauses.push('starred=1');
  if (query.unread === 'true') clauses.push('unread=1');
  if (isoDay(query.from)) { clauses.push('created_at>=?'); params.push(new Date(query.from).toISOString()); }
  if (isoDay(query.to)) { clauses.push('created_at<?'); params.push(new Date(query.to).toISOString()); }
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 200).toLowerCase() : '';
  if (search) {
    clauses.push('(instr(lower(answers),?)>0 OR instr(lower(note),?)>0 OR instr(lower(id),?)>0 OR instr(lower(attachments),?)>0)');
    params.push(search, search, search, search);
  }
  return { where: clauses.join(' AND '), params };
}

// Short plain-text preview built from the first answered questions.
export function summarize(response, separator, limit = 2) {
  const parts = [];
  for (const field of response.snapshot.fields) {
    if (!answerable(field) || field.type === 'file') continue;
    const text = formatAnswer(field, response.answers[field.id], separator);
    if (text) parts.push(text.length > 120 ? text.slice(0, 117) + '…' : text);
    if (parts.length >= limit) break;
  }
  return parts.join(' · ');
}
