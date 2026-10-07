// Answers supplied through the questionnaire link, e.g. /f/bug-report?site=Main%20site.
// Only questions with a link parameter accept them, and only values that pass validation.
import { checkAnswer } from '../../shared/answers.js';
import { prefillTypes } from '../../shared/constants.js';

const same = (a, b) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const matchOption = (field, value) => field.options.find(option => same(option, value));

export function readPrefill(fields, query = {}) {
  const lookup = Object.fromEntries(Object.entries(query).map(([key, value]) => [key.toLowerCase(), value]));
  const result = {};
  for (const field of fields) {
    if (!field.prefillKey || !prefillTypes.includes(field.type)) continue;
    const raw = lookup[field.prefillKey.toLowerCase()];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 5000) continue;
    let value = raw.trim();
    if (field.type === 'single' || field.type === 'select') value = matchOption(field, value);
    else if (field.type === 'multi') {
      // A whole-value match wins so options containing commas still work.
      const whole = matchOption(field, value);
      value = whole ? [whole] : [...new Set(value.split(/[,，]/).map(item => matchOption(field, item)).filter(Boolean))];
      if (!value.length) value = undefined;
    }
    if (value === undefined || checkAnswer({ ...field, required: false }, value).error) continue;
    result[field.id] = value;
  }
  return result;
}
