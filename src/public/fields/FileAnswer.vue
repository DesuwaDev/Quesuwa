<script setup>
import { computed, ref } from 'vue';
import { t } from '../../i18n.js';
import { fileKinds, fileKindKeys, fileKindExtensions, LIMITS } from '../../../shared/constants.js';
import { formatBytes } from '../../lib/format.js';
import AppIcon from '../../components/AppIcon.vue';

const props = defineProps({ field: Object, state: Object, disabled: Boolean, describedBy: String });
const dragging = ref(false);
const kinds = computed(() => props.field.fileKinds?.length ? props.field.fileKinds : fileKinds);
const maxFiles = computed(() => props.field.maxFiles || LIMITS.filesPerField);
const maxMB = computed(() => props.field.maxFileMB || LIMITS.fileMB);
const accept = computed(() => kinds.value.map(kind => fileKindExtensions[kind]).join(','));
const items = computed(() => props.state.uploads[props.field.id] || []);
const kindLabels = computed(() => kinds.value.map(kind => t(fileKindKeys[kind])).join(t('common.listSeparator')));

function groupOf(name) {
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return 'image';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(txt|log)$/i.test(name)) return 'text';
  return '';
}

function add(list) {
  if (props.disabled) return;
  delete props.state.errors[props.field.id];
  const selected = [...(list || [])];
  if (!selected.length) return;
  if (items.value.length + selected.length > maxFiles.value) {
    props.state.errors[props.field.id] = { code: 'errors.clientFileCount', params: { count: maxFiles.value } };
    return;
  }
  for (const file of selected) {
    if (!file.size || file.size > maxMB.value * 1024 * 1024) {
      props.state.errors[props.field.id] = { code: 'errors.clientFileSize', params: { name: file.name, size: maxMB.value } };
      return;
    }
    if (!kinds.value.includes(groupOf(file.name))) {
      props.state.errors[props.field.id] = { code: 'errors.clientFileType', params: { name: file.name, types: kindLabels.value } };
      return;
    }
  }
  props.state.uploads[props.field.id] = [...items.value, ...selected.map(file => ({ file, url: /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : null }))];
}

function remove(index) {
  const next = [...items.value];
  const [item] = next.splice(index, 1);
  if (item?.url) URL.revokeObjectURL(item.url);
  props.state.uploads[props.field.id] = next;
}

function drop(event) {
  dragging.value = false;
  add(event.dataTransfer?.files);
}
</script>

<template>
  <div class="file-answer">
    <label v-if="items.length < maxFiles" class="dropzone" :class="{ dragging, disabled }" @dragenter.prevent="dragging = true" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="drop">
      <AppIcon name="upload" :size="24" />
      <strong>{{ t('form.upload') }}</strong>
      <span>{{ t('form.uploadLimits', { count: maxFiles, size: maxMB, types: kindLabels }) }}</span>
      <input :id="'q-' + field.id" type="file" multiple :accept="accept" :disabled="disabled" :aria-describedby="describedBy" @change="add($event.target.files); $event.target.value = ''" />
    </label>
    <ul v-if="items.length" class="file-list">
      <li v-for="(item, index) in items" :key="item.file.name + index">
        <img v-if="item.url" :src="item.url" :alt="t('form.attachmentPreview')" />
        <span v-else class="file-icon"><AppIcon name="file" :size="18" /></span>
        <span class="file-name">{{ item.file.name }}<small>{{ formatBytes(item.file.size) }}</small></span>
        <button type="button" class="icon-button ghost small" :disabled="disabled" :aria-label="t('form.removeFile', { name: item.file.name })" @click="remove(index)"><AppIcon name="close" :size="16" /></button>
      </li>
    </ul>
  </div>
</template>
