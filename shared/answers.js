// Answer semantics shared by the questionnaire renderer and submission handler:
// conditional visibility, pagination, validation and plain-text formatting.
import { LIMITS, layoutTypes } from './constants.js';

export function isAnswered(field, value) {
  if (field.type === 'file') return Array.isArray(value) ? value.length > 0 : Number(value) > 0;
  if (field.type === 'matrix') return Array.isArray(value) && value.some(item => typeof item === 'string' && item !== '');
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return value !== undefined && value !== null;
}

function evaluate(rule, parent, value) {
  if (rule.op === 'answered') return isAnswered(parent, value);
  if (rule.op === 'notAnswered') return !isAnswered(parent, value);
  if (!isAnswered(parent, value)) return false;
  switch (rule.op) {
    case 'equals': return value === rule.value;
    case 'notEquals': return value !== rule.value;
    case 'includes': return Array.isArray(value) && value.includes(rule.value);
    case 'excludes': return Array.isArray(value) && !value.includes(rule.value);
    default: {
      const number = Number(value);
      if (!Number.isFinite(number)) return false;
      if (rule.op === 'eq') return number === rule.value;
      if (rule.op === 'neq') return number !== rule.value;
      if (rule.op === 'gt') return number > rule.value;
      if (rule.op === 'gte') return number >= rule.value;
      if (rule.op === 'lt') return number < rule.value;
      if (rule.op === 'lte') return number <= rule.value;
      return false;
    }
  }
}

// Resolves the questionnaire for the current answers. A field is shown when its
// rules pass; rules only see earlier visible fields. A hidden section hides every
// field until the next section (page skip logic). Visible fields are returned with
// options hidden by option conditions removed and conditional "required" applied.
export function resolveFields(fields, answers) {
  const byId = new Map(fields.map(field => [field.id, field]));
  const visible = new Set();
  const passes = logic => {
    const rules = logic?.rules;
    if (!rules?.length) return true;
    const results = rules.map(rule => visible.has(rule.fieldId) && evaluate(rule, byId.get(rule.fieldId), answers[rule.fieldId]));
    return logic.match === 'any' ? results.some(Boolean) : results.every(Boolean);
  };
  const resolved = [];
  let sectionHidden = false;
  for (const field of fields) {
    if (field.type === 'section') sectionHidden = !passes(field.logic);
    else if (sectionHidden || !passes(field.logic)) continue;
    if (sectionHidden) continue;
    let result = field;
    if (field.optionLogic?.length && Array.isArray(field.options)) {
      const hidden = new Set(field.optionLogic.filter(entry => !passes(entry.logic)).map(entry => entry.option));
      if (hidden.size) {
        const options = field.options.filter(option => !hidden.has(option));
        // A choice question with nothing left to choose is skipped entirely.
        if (!options.length && !field.allowOther) continue;
        result = { ...result, options, hiddenOptions: [...hidden] };
        if (result.minSelect) result.minSelect = Math.min(result.minSelect, options.length + (field.allowOther ? 1 : 0));
        if (result.maxSelect && result.minSelect > result.maxSelect) result.maxSelect = result.minSelect;
      }
    }
    if (!field.required && field.requiredLogic?.rules?.length && passes(field.requiredLogic)) result = { ...result, required: true };
    visible.add(field.id);
    resolved.push(result);
  }
  return resolved;
}
export const visibleFields = resolveFields;

export function paginate(fields) {
  const pages = [];
  let current = { section: null, fields: [] };
  for (const field of fields) {
    if (field.type === 'section') {
      if (current.section || current.fields.length) pages.push(current);
      current = { section: field, fields: [] };
    } else current.fields.push(field);
  }
  if (current.section || current.fields.length || !pages.length) pages.push(current);
  return pages;
}

const problem = (error, params = {}, value = '') => ({ value, error, params });
const integerIn = (value, min, max) => /^-?\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

// Returns the normalized value to store, or an error translation key.
export function checkAnswer(field, raw) {
  const type = field.type;
  if (layoutTypes.includes(type) || type === 'file') return { value: '', error: '' };
  if (type === 'multi' || type === 'ranking') {
    const list = raw ?? [];
    if (!Array.isArray(list) || list.some(item => typeof item !== 'string')) return problem('errors.answersInvalid', {}, []);
    const values = list.map(item => item.trim());
    if (values.some(item => field.hiddenOptions?.includes(item))) return problem('errors.choice', {}, []);
    if (new Set(values).size !== values.length || values.some(item => !item)) return problem('errors.choice', {}, []);
    if (!values.length) return field.required ? problem(type === 'ranking' ? 'errors.rankingIncomplete' : 'errors.required', {}, []) : { value: [], error: '' };
    if (type === 'ranking') {
      if (values.length !== field.options.length || values.some(item => !field.options.includes(item))) return problem('errors.rankingIncomplete', {}, values);
      return { value: values, error: '' };
    }
    const others = values.filter(item => !field.options.includes(item));
    if (others.length > (field.allowOther ? 1 : 0) || others.some(item => item.length > LIMITS.other)) return problem('errors.choice', {}, values);
    if (field.minSelect && values.length < field.minSelect) return problem('errors.minSelect', { count: field.minSelect }, values);
    if (field.maxSelect && values.length > field.maxSelect) return problem('errors.maxSelect', { count: field.maxSelect }, values);
    return { value: values, error: '' };
  }
  if (type === 'matrix') {
    const list = raw ?? [];
    if (!Array.isArray(list) || list.length > field.rows.length || list.some(item => typeof item !== 'string' || (item !== '' && !field.columns.includes(item)))) return problem('errors.answersInvalid', {}, []);
    const value = field.rows.map((_, index) => list[index] || '');
    if (field.required && value.some(item => !item)) return problem('errors.matrixIncomplete', {}, value);
    return { value: value.some(Boolean) ? value : [], error: '' };
  }
  if (raw === undefined || raw === null) raw = '';
  if (typeof raw !== 'string') return problem('errors.answersInvalid');
  const value = raw.trim();
  if (!value) return field.required ? problem('errors.required') : { value: '', error: '' };
  const max = type === 'long' ? field.maxLength || LIMITS.longText : type === 'short' ? field.maxLength || LIMITS.shortText : LIMITS.shortText;
  if (value.length > max) return problem('errors.tooLong', { max }, value);
  if (field.minLength && value.length < field.minLength) return problem('errors.tooShort', { min: field.minLength }, value);
  switch (type) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return problem('errors.email', {}, value);
      break;
    case 'url':
      try { if (!['http:', 'https:'].includes(new URL(value).protocol)) return problem('errors.url', {}, value); }
      catch { return problem('errors.url', {}, value); }
      break;
    case 'phone':
      if (!/^\+?[0-9][0-9 ()-]{4,24}$/.test(value) || value.replace(/\D/g, '').length < 5) return problem('errors.phone', {}, value);
      break;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return problem('errors.date', {}, value);
      break;
    case 'time':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return problem('errors.time', {}, value);
      break;
    case 'number': {
      const number = Number(value);
      if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value) || !Number.isFinite(number)) return problem('errors.number', {}, value);
      if (field.integer && !Number.isInteger(number)) return problem('errors.integer', {}, value);
      if (field.min !== null && field.min !== undefined && number < field.min) return problem('errors.numberMin', { min: field.min }, value);
      if (field.max !== null && field.max !== undefined && number > field.max) return problem('errors.numberMax', { max: field.max }, value);
      break;
    }
    case 'rating':
      if (!integerIn(value, 1, field.ratingMax || 5)) return problem('errors.scaleValue', {}, value);
      break;
    case 'scale':
      if (!integerIn(value, field.scaleMin ?? 1, field.scaleMax || 5)) return problem('errors.scaleValue', {}, value);
      break;
    case 'nps':
      if (!integerIn(value, 0, 10)) return problem('errors.scaleValue', {}, value);
      break;
    case 'single':
    case 'select':
      if (field.hiddenOptions?.includes(value)) return problem('errors.choice', {}, value);
      if (!field.options.includes(value) && !(type === 'single' && field.allowOther && value.length <= LIMITS.other)) return problem('errors.choice', {}, value);
      break;
  }
  return { value, error: '' };
}

export const isOtherValue = (field, value) => Boolean(field.allowOther) && typeof value === 'string' && value !== '' && !field.options?.includes(value);

// Plain-text rendering for exports, summaries and webhooks.
export function formatAnswer(field, value, separator) {
  if (!isAnswered(field, value)) return '';
  if (field.type === 'ranking' && Array.isArray(value)) return value.map((item, index) => `${index + 1}. ${item}`).join(separator);
  if (field.type === 'matrix' && Array.isArray(value)) return field.rows.map((row, index) => value[index] ? `${row}: ${value[index]}` : '').filter(Boolean).join(separator);
  if (Array.isArray(value)) return value.join(separator);
  return String(value);
}
