// Adds chosen, dropped or pasted files to a file question, enforcing its limits.
import { t } from '../../i18n.js';
import { fileKinds, fileKindKeys, fileKindExtensions, LIMITS } from '../../../shared/constants.js';

export const kindsOf = field => field.fileKinds?.length ? field.fileKinds : fileKinds;
export const acceptOf = field => kindsOf(field).map(kind => fileKindExtensions[kind]).join(',');
export const kindLabelsOf = field => kindsOf(field).map(kind => t(fileKindKeys[kind])).join(t('common.listSeparator'));

function groupOf(name) {
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return 'image';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(txt|log)$/i.test(name)) return 'text';
  return '';
}

// Clipboard images arrive as "image.png"; give them a unique, descriptive name.
export function namePasted(file, index) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
  if (!extension) return file;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return new File([file], `screenshot-${stamp}${index ? '-' + (index + 1) : ''}.${extension}`, { type: file.type, lastModified: Date.now() });
}

// Returns true when every file was accepted; otherwise records the error on the question.
export function addFiles(field, state, list) {
  delete state.errors[field.id];
  const selected = [...(list || [])];
  if (!selected.length) return false;
  const items = state.uploads[field.id] || [];
  const maxFiles = field.maxFiles || LIMITS.filesPerField, maxMB = field.maxFileMB || LIMITS.fileMB;
  if (items.length + selected.length > maxFiles) {
    state.errors[field.id] = { code: 'errors.clientFileCount', params: { count: maxFiles } };
    return false;
  }
  for (const file of selected) {
    if (!file.size || file.size > maxMB * 1024 * 1024) {
      state.errors[field.id] = { code: 'errors.clientFileSize', params: { name: file.name, size: maxMB } };
      return false;
    }
    if (!kindsOf(field).includes(groupOf(file.name))) {
      state.errors[field.id] = { code: 'errors.clientFileType', params: { name: file.name, types: kindLabelsOf(field) } };
      return false;
    }
  }
  state.uploads[field.id] = [...items, ...selected.map(file => ({ file, url: /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : null }))];
  return true;
}
