// Questionnaire definition schema: settings, fields and conditional logic.
// Used by the server as the source of truth and by the editor for defaults.
import {
  LIMITS, fieldTypes, layoutTypes, choiceTypes, optionTypes, numericTypes, otherTypes,
  formStates, accents, fileKinds
} from './constants.js';

export const defaultSettings = Object.freeze({
  listed: false,
  showProgress: true,
  showNumbers: true,
  saveProgress: true,
  onePerDevice: false,
  ticketMode: false,
  startsAt: '',
  endsAt: '',
  responseLimit: 0,
  submitLabel: '',
  consentText: '',
  closedMessage: '',
  accessCode: '',
  accent: 'coral',
  webhookUrl: '',
  webhookSecret: ''
});

export const failure = (code, params = {}) => Object.assign(new Error(code), { status: 400, code, params });

function text(value, max, code, params, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw failure(code, params);
  const result = value.trim();
  if (result.length > max || (required && !result)) throw failure(code, params);
  return result;
}

function integer(value, min, max, fallback, code, params) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw failure(code, params);
  return value;
}

function bool(value, fallback, code, params) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw failure(code, params);
  return value;
}

function dateTime(value, code) {
  if (!value) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw failure(code);
  return new Date(value).toISOString();
}

export function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function normalizeSettings(value = {}) {
  const code = 'errors.settingsInvalid';
  if (value === undefined || value === null) value = {};
  if (typeof value !== 'object' || Array.isArray(value)) throw failure(code);
  const result = { ...defaultSettings };
  for (const key of ['listed', 'showProgress', 'showNumbers', 'saveProgress', 'onePerDevice', 'ticketMode']) result[key] = bool(value[key], defaultSettings[key], code);
  result.startsAt = dateTime(value.startsAt, code);
  result.endsAt = dateTime(value.endsAt, code);
  if (result.startsAt && result.endsAt && result.startsAt >= result.endsAt) throw failure('errors.scheduleInvalid');
  result.responseLimit = integer(value.responseLimit, 0, 1000000, 0, code);
  result.submitLabel = text(value.submitLabel, 60, code);
  result.consentText = text(value.consentText, 2000, code);
  result.closedMessage = text(value.closedMessage, 1000, code);
  result.accessCode = text(value.accessCode, 64, 'errors.accessCodeInvalid');
  if (value.accent !== undefined && !accents.includes(value.accent)) throw failure(code);
  result.accent = value.accent || defaultSettings.accent;
  result.webhookUrl = text(value.webhookUrl, 500, 'errors.webhookUrl');
  if (result.webhookUrl && !isHttpUrl(result.webhookUrl)) throw failure('errors.webhookUrl');
  result.webhookSecret = text(value.webhookSecret, 128, code);
  return result;
}

// Operators available for conditions that depend on a field of the given type.
export function operatorsFor(type) {
  if (type === 'single' || type === 'select') return ['equals', 'notEquals', 'answered', 'notAnswered'];
  if (type === 'multi') return ['includes', 'excludes', 'answered', 'notAnswered'];
  if (numericTypes.includes(type)) return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'answered', 'notAnswered'];
  if (layoutTypes.includes(type)) return [];
  return ['answered', 'notAnswered'];
}
export const operatorNeedsValue = op => !['answered', 'notAnswered'].includes(op);
export const operatorUsesOption = op => ['equals', 'notEquals', 'includes', 'excludes'].includes(op);

function normalizeLogic(field, earlier, index) {
  let logic = field.logic;
  // Legacy definitions stored a single "choice equals option" condition.
  if (!logic && field.condition?.fieldId) {
    const parent = earlier.find(f => f.id === field.condition.fieldId);
    logic = { match: 'all', rules: [{ fieldId: field.condition.fieldId, op: parent?.type === 'multi' ? 'includes' : 'equals', value: field.condition.value }] };
  }
  return normalizeRuleSet(logic, earlier, index);
}

// A rule set is { match: 'all' | 'any', rules: [{ fieldId, op, value }] } over earlier questions.
function normalizeRuleSet(logic, earlier, index) {
  const params = { index: index + 1 };
  if (!logic) return null;
  if (typeof logic !== 'object' || Array.isArray(logic) || !['all', 'any'].includes(logic.match ?? 'all') || !Array.isArray(logic.rules)) throw failure('errors.logicInvalid', params);
  if (!logic.rules.length) return null;
  if (logic.rules.length > LIMITS.logicRules) throw failure('errors.logicInvalid', params);
  const rules = logic.rules.map(rule => {
    if (!rule || typeof rule !== 'object') throw failure('errors.logicInvalid', params);
    const parent = earlier.find(f => f.id === rule.fieldId);
    if (!parent || layoutTypes.includes(parent.type) || !operatorsFor(parent.type).includes(rule.op)) throw failure('errors.logicInvalid', params);
    let value = '';
    if (operatorUsesOption(rule.op)) {
      if (typeof rule.value !== 'string' || !parent.options.includes(rule.value)) throw failure('errors.logicInvalid', params);
      value = rule.value;
    } else if (operatorNeedsValue(rule.op)) {
      const number = typeof rule.value === 'string' && rule.value.trim() !== '' ? Number(rule.value) : rule.value;
      if (typeof number !== 'number' || !Number.isFinite(number)) throw failure('errors.logicInvalid', params);
      value = number;
    }
    return { fieldId: parent.id, op: rule.op, value };
  });
  return { match: logic.match ?? 'all', rules };
}

function optionList(values, min, max, index, maxLength = LIMITS.option) {
  const params = { index: index + 1, min, max };
  if (!Array.isArray(values) || values.length < min || values.length > max) throw failure('errors.optionCount', params);
  const result = values.map(value => text(value, maxLength, 'errors.optionInvalid', params, { required: true }));
  if (new Set(result).size !== result.length) throw failure('errors.duplicateOptions', params);
  return result;
}

function numberOrNull(value, index) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw failure('errors.fieldRules', { index: index + 1 });
  return value;
}

export function normalizeField(field, index, earlier) {
  const params = { index: index + 1 };
  if (!field || typeof field !== 'object' || Array.isArray(field) || !Object.hasOwn(fieldTypes, field.type)
    || typeof field.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(field.id)
    || ['__proto__', 'constructor', 'prototype'].includes(field.id)) throw failure('errors.fieldInvalid', params);
  const type = field.type;
  const result = {
    id: field.id,
    type,
    label: text(field.label, LIMITS.label, 'errors.fieldLabel', params, { required: true }),
    description: text(field.description, LIMITS.fieldDescription, 'errors.fieldRules', params),
    required: layoutTypes.includes(type) ? false : field.required === true
  };
  const rule = (value, min, max, fallback) => integer(value, min, max, fallback, 'errors.fieldRules', params);
  if (['short', 'long', 'email', 'phone', 'url', 'number'].includes(type)) result.placeholder = text(field.placeholder, 200, 'errors.fieldRules', params);
  if (type === 'short' || type === 'long') {
    const limit = type === 'long' ? LIMITS.longText : LIMITS.shortText;
    result.minLength = rule(field.minLength, 0, limit, 0);
    result.maxLength = rule(field.maxLength, 1, limit, limit);
    if (result.minLength > result.maxLength) throw failure('errors.fieldRules', params);
  }
  if (type === 'number') {
    result.min = numberOrNull(field.min, index);
    result.max = numberOrNull(field.max, index);
    result.integer = bool(field.integer, false, 'errors.fieldRules', params);
    if (result.min !== null && result.max !== null && result.min > result.max) throw failure('errors.fieldRules', params);
  }
  if (choiceTypes.includes(type)) {
    result.options = optionList(field.options, 2, LIMITS.options, index);
    result.shuffle = bool(field.shuffle, false, 'errors.fieldRules', params);
  }
  if (otherTypes.includes(type)) result.allowOther = bool(field.allowOther, false, 'errors.fieldRules', params);
  if (type === 'multi') {
    result.minSelect = rule(field.minSelect, 0, result.options.length, 0);
    result.maxSelect = rule(field.maxSelect, 0, result.options.length, 0);
    if (result.maxSelect && result.minSelect > result.maxSelect) throw failure('errors.fieldRules', params);
  }
  if (type === 'ranking') {
    result.options = optionList(field.options, 2, LIMITS.rankingOptions, index);
    result.shuffle = bool(field.shuffle, false, 'errors.fieldRules', params);
  }
  if (type === 'rating') result.ratingMax = rule(field.ratingMax, 2, 10, 5);
  if (type === 'scale') {
    result.scaleMin = rule(field.scaleMin, 0, 1, 1);
    result.scaleMax = rule(field.scaleMax, 2, 10, 5);
  }
  if (type === 'scale' || type === 'nps') {
    result.minLabel = text(field.minLabel, LIMITS.scaleLabel, 'errors.fieldRules', params);
    result.maxLabel = text(field.maxLabel, LIMITS.scaleLabel, 'errors.fieldRules', params);
  }
  if (type === 'matrix') {
    result.rows = optionList(field.rows, 1, LIMITS.matrixRows, index);
    result.columns = optionList(field.columns, 2, LIMITS.matrixColumns, index, 100);
  }
  if (type === 'file') {
    result.maxFiles = rule(field.maxFiles, 1, LIMITS.filesPerField, LIMITS.filesPerField);
    result.maxFileMB = rule(field.maxFileMB, 1, LIMITS.fileMB, LIMITS.fileMB);
    const kinds = field.fileKinds ?? [...fileKinds];
    if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !fileKinds.includes(kind)) || new Set(kinds).size !== kinds.length) throw failure('errors.fieldRules', params);
    result.fileKinds = fileKinds.filter(kind => kinds.includes(kind));
  }
  if (type !== 'statement' || field.logic || field.condition) result.logic = normalizeLogic(field, earlier, index);
  if (!result.logic) delete result.logic;
  // Optional questions can become required when conditions are met.
  if (!layoutTypes.includes(type) && !result.required) {
    const requiredLogic = normalizeRuleSet(field.requiredLogic, earlier, index);
    if (requiredLogic) result.requiredLogic = requiredLogic;
  }
  // Individual options can be hidden unless their conditions are met.
  if (optionTypes.includes(type) && field.optionLogic !== undefined && field.optionLogic !== null) {
    if (!Array.isArray(field.optionLogic) || field.optionLogic.length > result.options.length) throw failure('errors.logicInvalid', params);
    const seen = new Set();
    const optionLogic = [];
    for (const entry of field.optionLogic) {
      if (!entry || typeof entry !== 'object' || !result.options.includes(entry.option) || seen.has(entry.option)) throw failure('errors.logicInvalid', params);
      seen.add(entry.option);
      const logic = normalizeRuleSet(entry.logic, earlier, index);
      if (logic) optionLogic.push({ option: entry.option, logic });
    }
    if (optionLogic.length) result.optionLogic = optionLogic;
  }
  return result;
}

export function normalizeDefinition(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('errors.formInvalid');
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) throw failure('errors.slugInvalid');
  if (!formStates.includes(body.state)) throw failure('errors.stateInvalid');
  if (!Array.isArray(body.fields) || body.fields.length > LIMITS.fields) throw failure('errors.tooManyFields', { max: LIMITS.fields });
  const ids = new Set(), fields = [];
  for (const [index, raw] of body.fields.entries()) {
    const field = normalizeField(raw, index, fields);
    if (ids.has(field.id)) throw failure('errors.fieldInvalid', { index: index + 1 });
    ids.add(field.id);
    fields.push(field);
  }
  if (body.state === 'published' && !fields.some(f => !layoutTypes.includes(f.type))) throw failure('errors.noFields');
  if (fields.filter(f => f.type === 'file').length > LIMITS.fileFields) throw failure('errors.fileFieldCount', { max: LIMITS.fileFields });
  return {
    slug,
    state: body.state,
    title: text(body.title, LIMITS.title, 'errors.titleInvalid', {}, { required: true }),
    description: text(body.description, LIMITS.description, 'errors.formTextInvalid'),
    thanks: text(body.thanks, LIMITS.thanks, 'errors.formTextInvalid'),
    settings: normalizeSettings(body.settings),
    fields
  };
}

// Editor helpers: a complete shape keeps type switching lossless while editing.
export function editableField(field) {
  return {
    description: '', required: false, placeholder: '', minLength: 0, maxLength: field.type === 'long' ? LIMITS.longText : LIMITS.shortText,
    min: null, max: null, integer: false, options: [], shuffle: false, allowOther: false, minSelect: 0, maxSelect: 0,
    ratingMax: 5, scaleMin: 1, scaleMax: 5, minLabel: '', maxLabel: '', rows: [], columns: [],
    maxFiles: LIMITS.filesPerField, maxFileMB: LIMITS.fileMB, fileKinds: [...fileKinds], logic: null, requiredLogic: null, optionLogic: [],
    ...structuredClone(field)
  };
}

export const answerable = field => !layoutTypes.includes(field.type);
export const hasOptions = type => optionTypes.includes(type);
