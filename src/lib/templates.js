// Starter questionnaires. Text is generated in the current interface language
// when the questionnaire is created; afterwards it is ordinary editable content.
import { t } from '../i18n.js';

let counter = 0;
const id = () => 'q' + Date.now().toString(36) + (counter++).toString(36);
const list = (prefix, count) => Array.from({ length: count }, (_, index) => t(`${prefix}${index + 1}`));

const builders = {
  satisfaction: () => ({
    fields: [
      { id: id(), type: 'nps', label: t('tpl.satisfaction.q1'), required: true },
      { id: id(), type: 'rating', label: t('tpl.satisfaction.q2'), ratingMax: 5, required: true },
      { id: id(), type: 'single', label: t('tpl.satisfaction.q3'), options: list('tpl.satisfaction.q3o', 4), required: false },
      { id: id(), type: 'multi', label: t('tpl.satisfaction.q4'), options: list('tpl.satisfaction.q4o', 5), allowOther: true, maxSelect: 3 },
      { id: id(), type: 'long', label: t('tpl.satisfaction.q5'), description: t('tpl.satisfaction.q5d') }
    ]
  }),
  registration: () => ({
    fields: [
      { id: id(), type: 'short', label: t('tpl.registration.q1'), required: true, maxLength: 60 },
      { id: id(), type: 'email', label: t('tpl.registration.q2'), required: true },
      { id: id(), type: 'phone', label: t('tpl.registration.q3') },
      { id: id(), type: 'select', label: t('tpl.registration.q4'), options: list('tpl.registration.q4o', 3), required: true },
      { id: id(), type: 'number', label: t('tpl.registration.q5'), min: 0, max: 10, integer: true },
      { id: id(), type: 'single', label: t('tpl.registration.q6'), options: list('tpl.registration.q6o', 3), allowOther: true },
      { id: id(), type: 'long', label: t('tpl.registration.q7') }
    ],
    settings: { onePerDevice: true }
  }),
  bug: () => ({
    fields: [
      { id: id(), type: 'select', label: t('tpl.bug.q1'), options: list('tpl.bug.q1o', 5), required: true },
      { id: id(), type: 'short', label: t('tpl.bug.q2'), required: true, maxLength: 120 },
      { id: id(), type: 'long', label: t('tpl.bug.q3'), description: t('tpl.bug.q3d'), required: true },
      { id: id(), type: 'single', label: t('tpl.bug.q4'), options: list('tpl.bug.q4o', 4), required: true },
      { id: id(), type: 'url', label: t('tpl.bug.q5') },
      { id: id(), type: 'date', label: t('tpl.bug.q6') },
      { id: id(), type: 'file', label: t('tpl.bug.q7'), description: t('tpl.bug.q7d'), maxFiles: 3 },
      { id: id(), type: 'email', label: t('tpl.bug.q8'), description: t('tpl.bug.q8d') }
    ]
  }),
  training: () => ({
    fields: [
      { id: id(), type: 'matrix', label: t('tpl.training.q1'), rows: list('tpl.training.q1r', 4), columns: list('tpl.training.q1c', 5), required: true },
      { id: id(), type: 'scale', label: t('tpl.training.q2'), scaleMin: 1, scaleMax: 10, minLabel: t('tpl.training.q2min'), maxLabel: t('tpl.training.q2max'), required: true },
      { id: id(), type: 'ranking', label: t('tpl.training.q3'), options: list('tpl.training.q3o', 4) },
      { id: id(), type: 'long', label: t('tpl.training.q4') }
    ]
  }),
  pulse: () => {
    const leave = id();
    const leaveOptions = list('tpl.pulse.q5o', 3);
    return {
      fields: [
        { id: id(), type: 'section', label: t('tpl.pulse.s1'), description: t('tpl.pulse.s1d') },
        { id: id(), type: 'select', label: t('tpl.pulse.q1'), options: list('tpl.pulse.q1o', 6), required: true },
        { id: id(), type: 'single', label: t('tpl.pulse.q2'), options: list('tpl.pulse.q2o', 4), required: true },
        { id: id(), type: 'section', label: t('tpl.pulse.s2') },
        { id: id(), type: 'matrix', label: t('tpl.pulse.q3'), rows: list('tpl.pulse.q3r', 4), columns: list('tpl.pulse.q3c', 5), required: true },
        { id: id(), type: 'nps', label: t('tpl.pulse.q4'), required: true },
        { id: leave, type: 'single', label: t('tpl.pulse.q5'), options: leaveOptions, required: true },
        { id: id(), type: 'long', label: t('tpl.pulse.q6'), required: true, logic: { match: 'all', rules: [{ fieldId: leave, op: 'notEquals', value: leaveOptions[0] }] } },
        { id: id(), type: 'statement', label: t('tpl.pulse.end'), description: t('tpl.pulse.endd') }
      ],
      settings: { onePerDevice: true }
    };
  }
};

export const templates = [
  { key: 'blank', icon: 'plus', title: 'tpl.blank.title', text: 'tpl.blank.text' },
  { key: 'satisfaction', icon: 'star', title: 'tpl.satisfaction.title', text: 'tpl.satisfaction.text' },
  { key: 'registration', icon: 'calendar', title: 'tpl.registration.title', text: 'tpl.registration.text' },
  { key: 'bug', icon: 'alert', title: 'tpl.bug.title', text: 'tpl.bug.text' },
  { key: 'training', icon: 'grid', title: 'tpl.training.title', text: 'tpl.training.text' },
  { key: 'pulse', icon: 'branch', title: 'tpl.pulse.title', text: 'tpl.pulse.text' }
];

export function buildTemplate(key) {
  const meta = templates.find(item => item.key === key) || templates[0];
  const extra = builders[meta.key]?.() || { fields: [] };
  return {
    title: meta.key === 'blank' ? t('common.untitled') : t(meta.title),
    description: meta.key === 'blank' ? '' : t(`tpl.${meta.key}.description`),
    thanks: t('common.thanks'),
    state: 'draft',
    fields: extra.fields,
    settings: extra.settings || {}
  };
}
