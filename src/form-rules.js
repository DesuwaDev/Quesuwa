export const defaultSettings = {
  listed: false, showProgress: true, startsAt: '', endsAt: '', responseLimit: 0,
  submitLabel: '', consentText: ''
};
export const inputTypes = { short: 'text', email: 'email', url: 'url', number: 'number', date: 'date', rating: 'number' };
export const fileKinds = ['image', 'pdf', 'text'];
export const fileKindKeys = { image: 'settings.images', pdf: 'settings.pdf', text: 'settings.textFiles' };
const invalid = () => { throw Object.assign(new Error('errors.settingsInvalid'), { status: 400, code: 'errors.settingsInvalid' }); };
const integer = (value, min, max, fallback) => {
  if (value === undefined || value === '') return fallback;
  if (!Number.isInteger(value) || value < min || value > max) invalid();
  return value;
};
export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = { ...defaultSettings };
  for (const key of ['listed', 'showProgress']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') invalid();
    result[key] = value[key] ?? result[key];
  }
  for (const key of ['startsAt', 'endsAt']) {
    const raw = value[key] || '';
    if (typeof raw !== 'string' || (raw && (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || !Number.isFinite(Date.parse(raw))))) invalid();
    result[key] = raw ? new Date(raw).toISOString() : '';
  }
  if (result.startsAt && result.endsAt && result.startsAt >= result.endsAt) invalid();
  result.responseLimit = integer(value.responseLimit, 0, 1000000, 0);
  for (const [key, max] of [['submitLabel', 60], ['consentText', 2000]]) {
    const text = value[key] ?? '';
    if (typeof text !== 'string' || text.length > max) invalid();
    result[key] = text.trim();
  }
  return result;
}
export function normalizeRules(field, earlierFields) {
  const result = {
    placeholder: typeof field.placeholder === 'string' ? field.placeholder.trim().slice(0, 200) : '',
    maxLength: integer(field.maxLength, 1, field.type === 'long' ? 10000 : 1000, field.type === 'long' ? 10000 : 1000),
    maxFiles: integer(field.maxFiles, 1, 3, 3),
    maxFileMB: integer(field.maxFileMB, 1, 10, 10),
    ratingMax: integer(field.ratingMax, 2, 10, 5),
    fileKinds: field.fileKinds ?? [...fileKinds],
    min: null, max: null, condition: null
  };
  if (!Array.isArray(result.fileKinds) || !result.fileKinds.length || result.fileKinds.some(x => !fileKinds.includes(x))) invalid();
  for (const key of ['min', 'max']) {
    if (field[key] !== undefined && field[key] !== null && field[key] !== '') {
      if (typeof field[key] !== 'number' || !Number.isFinite(field[key]) || Math.abs(field[key]) > 1e12) invalid();
      result[key] = field[key];
    }
  }
  if (result.min !== null && result.max !== null && result.min > result.max) invalid();
  if (field.condition?.fieldId) {
    const parent = earlierFields.find(f => f.id === field.condition.fieldId);
    if (!parent || !['single', 'multi', 'select'].includes(parent.type) || !parent.options.includes(field.condition.value)) invalid();
    result.condition = { fieldId: parent.id, value: field.condition.value };
  }
  return result;
}
export function visibleFields(fields, answers) {
  const visible = new Set();
  return fields.filter(field => {
    const condition = field.condition;
    if (condition?.fieldId) {
      const answer = answers[condition.fieldId];
      if (!visible.has(condition.fieldId) || !(Array.isArray(answer) ? answer.includes(condition.value) : answer === condition.value)) return false;
    }
    visible.add(field.id);
    return true;
  });
}
export function answerError(field, value) {
  if (!value) return field.required ? 'errors.required' : '';
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'errors.email';
  if (field.type === 'url') {
    try { if (!['http:', 'https:'].includes(new URL(value).protocol)) return 'errors.url'; }
    catch { return 'errors.url'; }
  }
  if (field.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return 'errors.date';
  }
  if (['number', 'rating'].includes(field.type)) {
    const number = Number(value);
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value) || !Number.isFinite(number)) return 'errors.number';
    if (field.type === 'rating' && (!Number.isInteger(number) || number < 1 || number > (field.ratingMax || 5))) return 'errors.number';
    if ((field.min != null && number < field.min) || (field.max != null && number > field.max)) return 'errors.numberRange';
  }
  return '';
}
