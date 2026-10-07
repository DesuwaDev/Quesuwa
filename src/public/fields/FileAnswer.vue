<script setup>
import { computed, ref } from 'vue';
import { t } from '../../i18n.js';
import { LIMITS } from '../../../shared/constants.js';
import { formatBytes } from '../../lib/format.js';
import AppIcon from '../../components/AppIcon.vue';
import { acceptOf, addFiles, kindLabelsOf } from './files.js';

const props = defineProps({ field: Object, state: Object, disabled: Boolean, describedBy: String });
const dragging = ref(false);
const maxFiles = computed(() => props.field.maxFiles || LIMITS.filesPerField);
const maxMB = computed(() => props.field.maxFileMB || LIMITS.fileMB);
const accept = computed(() => acceptOf(props.field));
const items = computed(() => props.state.uploads[props.field.id] || []);
const kindLabels = computed(() => kindLabelsOf(props.field));
const acceptsImages = computed(() => accept.value.includes('.png'));
// Screenshots can be pasted on devices with a keyboard.
const canPaste = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

function add(list) {
  if (!props.disabled) addFiles(props.field, props.state, list);
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
      <span v-if="canPaste && acceptsImages" class="paste-hint"><AppIcon name="image" :size="13" />{{ t('form.pasteHint') }}</span>
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
