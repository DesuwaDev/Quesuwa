// Editor-side helpers for creating and maintaining question definitions.
import { t } from '../../i18n.js';
import { fieldTypes, optionTypes, layoutTypes } from '../../../shared/constants.js';
import { editableField, operatorsFor, operatorUsesOption, operatorNeedsValue } from '../../../shared/schema.js';

export const uid = () => (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2))).replaceAll('-', '').slice(0, 16);
export const optionDefaults = count => Array.from({ length: count }, (_, index) => t('editor.optionNumber', { number: index + 1 }));

function seed(field) {
  if (optionTypes.includes(field.type) && field.options.length < 2) field.options = optionDefaults(field.type === 'ranking' ? 3 : 2);
  if (field.type === 'matrix') {
    if (!field.rows.length) field.rows = Array.from({ length: 3 }, (_, index) => t('editor.rowNumber', { number: index + 1 }));
    if (field.columns.length < 2) field.columns = [t('editor.scaleDisagree'), t('editor.scaleNeutral'), t('editor.scaleAgree')];
  }
  if (layoutTypes.includes(field.type)) field.required = false;
  return field;
}

export function newField(type) {
  const label = type === 'section' ? t('editor.newSection') : type === 'statement' ? t('editor.newStatement') : t('editor.newQuestion', { type: t(fieldTypes[type]) });
  return seed(editableField({ id: uid(), type, label }));
}

export function changeType(field, type) {
  const defaultLabel = t('editor.newQuestion', { type: t(fieldTypes[field.type]) });
  field.type = type;
  if (field.label === defaultLabel) field.label = type === 'section' ? t('editor.newSection') : type === 'statement' ? t('editor.newStatement') : t('editor.newQuestion', { type: t(fieldTypes[type]) });
  if (type === 'ranking' && field.options.length > 15) field.options = field.options.slice(0, 15);
  seed(field);
}

export function cloneField(field) {
  return { ...structuredClone(field), id: uid() };
}

// Rule sets on a field: display logic, conditional required and per-option conditions.
const ruleSets = field => [
  { get: () => field.logic, set: value => { field.logic = value; } },
  { get: () => field.requiredLogic, set: value => { field.requiredLogic = value; } },
  ...(field.optionLogic || []).map(entry => ({ get: () => entry.logic, set: value => { entry.logic = value; } }))
];

// Drops rules that no longer reference an earlier answerable question or an existing option.
export function repairLogic(fields) {
  let changed = 0;
  fields.forEach((field, index) => {
    const earlier = fields.slice(0, index);
    if (Array.isArray(field.optionLogic)) {
      const kept = field.optionLogic.filter(entry => field.options?.includes(entry.option));
      changed += field.optionLogic.length - kept.length;
      if (kept.length !== field.optionLogic.length) field.optionLogic = kept;
    }
    for (const set of ruleSets(field)) {
      const logic = set.get();
      if (!logic) continue;
      const rules = (logic.rules || []).filter(rule => {
        const parent = earlier.find(item => item.id === rule.fieldId);
        if (!parent || !operatorsFor(parent.type).includes(rule.op)) return false;
        if (operatorUsesOption(rule.op)) return parent.options.includes(rule.value);
        if (operatorNeedsValue(rule.op)) return rule.value !== '' && rule.value !== null && Number.isFinite(Number(rule.value));
        return true;
      });
      const removed = (logic.rules || []).length - rules.length;
      changed += removed;
      if (!rules.length) set.set(null);
      else if (removed) set.set({ ...logic, rules });
    }
    if (Array.isArray(field.optionLogic) && field.optionLogic.some(entry => !entry.logic)) field.optionLogic = field.optionLogic.filter(entry => entry.logic);
  });
  return changed;
}

export function renameOption(fields, fieldId, previous, next) {
  for (const field of fields) {
    for (const set of ruleSets(field)) {
      for (const rule of set.get()?.rules || []) if (rule.fieldId === fieldId && operatorUsesOption(rule.op) && rule.value === previous) rule.value = next;
    }
    if (field.id === fieldId) for (const entry of field.optionLogic || []) if (entry.option === previous) entry.option = next;
  }
}

// Number values typed into rules are strings until saved.
const serializeRuleSet = logic => logic?.rules?.length ? { match: logic.match, rules: logic.rules.map(rule => ({ ...rule, value: operatorUsesOption(rule.op) ? rule.value : operatorNeedsValue(rule.op) ? Number(rule.value) : '' })) } : null;

export function serializeFields(fields) {
  return fields.map(field => ({
    ...field,
    logic: serializeRuleSet(field.logic),
    requiredLogic: field.required ? null : serializeRuleSet(field.requiredLogic),
    optionLogic: (field.optionLogic || []).map(entry => ({ option: entry.option, logic: serializeRuleSet(entry.logic) })).filter(entry => entry.logic)
  }));
}

export const hasLogic = field => Boolean(field.logic?.rules?.length || field.requiredLogic?.rules?.length || field.optionLogic?.length);
