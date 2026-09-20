import { translate, defaultLocale } from '../i18n/core.js';
export const fieldTypes = { short: 'type.short', long: 'type.long', single: 'type.single', multi: 'type.multi', select: 'type.select', file: 'type.file' };
export const statuses = ['pending', 'inProgress', 'resolved', 'needsInfo'];
export const statusKeys = { pending: 'status.pending', inProgress: 'status.inProgress', resolved: 'status.resolved', needsInfo: 'status.needsInfo' };
export const stateKeys = { draft: 'state.draft', published: 'state.published', closed: 'state.closed' };
export const choiceTypes = ['single', 'multi', 'select'];
export function bugTemplate(language = defaultLocale) {
  const t = (key, params) => translate(language, key, params);
  const field = (id, type, label, required, description = '', options = []) => ({ id, type, label, required, description, options });
  return {
    title: t('template.title'), description: t('template.description'), thanks: t('template.thanks'),
    fields: [
      field('category', 'single', t('template.category'), true, '', [t('template.optionLogin'), t('template.optionFeatures'), t('template.optionImport'), t('template.optionData'), t('template.optionSettings'), t('template.optionPage'), t('template.optionOther')]),
      field('description', 'long', t('template.details'), true, t('template.detailsHint')),
      field('device', 'short', t('template.device'), true, t('template.deviceHint')),
      field('frequency', 'single', t('template.frequency'), true, '', [t('template.always'), t('template.sometimes'), t('template.once'), t('template.unsure')]),
      field('clues', 'long', t('template.clues'), false, t('template.cluesHint')),
      field('attachment', 'file', t('template.attachment'), false, t('template.attachmentHint')),
      field('contact', 'short', t('template.contact'), false, t('template.contactHint')),
    ],
  };
}
