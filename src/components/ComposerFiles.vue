<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { formatBytes } from '../lib/format.js';
import { fileKinds, fileKindExtensions, fileKindKeys } from '../../shared/constants.js';
import { groupOf, namePasted } from '../public/fields/files.js';
import AppIcon from './AppIcon.vue';

// Files chosen, pasted or dropped into a message before it is sent.
const props = defineProps({ modelValue: { type: Array, default: () => [] }, max: { type: Number, default: 5 }, maxMB: { type: Number, default: 10 } });
const emit = defineEmits(['update:modelValue']);
const input = ref(null), error = ref('');
const accept = fileKinds.map(kind => fileKindExtensions[kind]).join(',');
const previews = new Map();
const previewOf = file => {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return '';
  if (!previews.has(file)) previews.set(file, URL.createObjectURL(file));
  return previews.get(file);
};
const release = file => { if (previews.has(file)) { URL.revokeObjectURL(previews.get(file)); previews.delete(file); } };

function add(list, pasted = false) {
  error.value = '';
  const incoming = [...(list || [])].map((file, index) => pasted ? namePasted(file, index) : file);
  if (!incoming.length) return false;
  if (props.modelValue.length + incoming.length > props.max) { error.value = t('errors.clientFileCount', { count: props.max }); return false; }
  for (const file of incoming) {
    if (!file.size || file.size > props.maxMB * 1024 * 1024) { error.value = t('errors.clientFileSize', { name: file.name, size: props.maxMB }); return false; }
    if (!groupOf(file.name)) { error.value = t('errors.clientFileType', { name: file.name, types: fileKinds.map(kind => t(fileKindKeys[kind])).join(t('common.listSeparator')) }); return false; }
  }
  emit('update:modelValue', [...props.modelValue, ...incoming]);
  return true;
}
function remove(index) {
  const next = [...props.modelValue];
  const [file] = next.splice(index, 1);
  release(file);
  emit('update:modelValue', next);
}
watch(() => props.modelValue.length, count => { if (!count) { for (const file of [...previews.keys()]) release(file); error.value = ''; } });
onBeforeUnmount(() => { for (const file of [...previews.keys()]) release(file); });
defineExpose({ pick: () => input.value?.click(), add });
</script>

<template>
  <div class="composer-files">
    <input ref="input" type="file" class="sr-only" multiple :accept="accept" tabindex="-1" aria-hidden="true" @change="add($event.target.files); $event.target.value = ''" />
    <ul v-if="modelValue.length" class="composer-file-list">
      <li v-for="(file, index) in modelValue" :key="file.name + file.size + index">
        <img v-if="previewOf(file)" :src="previewOf(file)" :alt="file.name" />
        <span v-else class="file-icon"><AppIcon name="file" :size="16" /></span>
        <span class="composer-file-name">{{ file.name }}<small>{{ formatBytes(file.size) }}</small></span>
        <button type="button" class="icon-button ghost small" :aria-label="t('form.removeFile', { name: file.name })" @click="remove(index)"><AppIcon name="close" :size="14" /></button>
      </li>
    </ul>
    <p v-if="error" class="field-error small" role="alert">{{ error }}</p>
  </div>
</template>
