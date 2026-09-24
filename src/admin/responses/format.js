import { t } from '../../i18n.js';
import { answerable } from '../../../shared/schema.js';
import { formatAnswer } from '../../../shared/answers.js';

export function summarizeResponse(response, limit = 2) {
  const parts = [];
  for (const field of response.snapshot.fields) {
    if (!answerable(field) || field.type === 'file') continue;
    const text = formatAnswer(field, response.answers[field.id], t('common.listSeparator'));
    if (text) parts.push(text);
    if (parts.length >= limit) break;
  }
  return parts.join(' · ');
}

export const answerText = (field, value) => formatAnswer(field, value, t('common.listSeparator'));
