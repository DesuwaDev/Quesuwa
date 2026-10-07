<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { formatBytes } from '../lib/format.js';
import AppIcon from './AppIcon.vue';

// source(file, inline) returns a URL. Staff use direct links; respondent pages fetch with the
// ticket key in a header and hand back blob URLs.
const props = defineProps({ files: { type: Array, default: () => [] }, source: { type: Function, required: true } });
const urls = ref({});
const kind = file => /^image\//.test(file.mime) ? 'image' : /^video\//.test(file.mime) ? 'video' : 'file';
const created = [];

async function preview() {
  for (const file of props.files) {
    if (kind(file) === 'file' || urls.value[file.id]) continue;
    try {
      const url = await props.source(file, true);
      if (url.startsWith('blob:')) created.push(url);
      urls.value = { ...urls.value, [file.id]: url };
    } catch { /* Falls back to a download button. */ }
  }
}
watch(() => props.files.map(file => file.id).join(), preview, { immediate: true });
onBeforeUnmount(() => created.forEach(url => URL.revokeObjectURL(url)));

async function download(file) {
  try {
    const url = await props.source(file, false);
    Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
    if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* The button stays available for another try. */ }
}
</script>

<template>
  <div v-if="files.length" class="message-files">
    <template v-for="file in files" :key="file.id">
      <a v-if="kind(file) === 'image' && urls[file.id]" class="message-image" :href="urls[file.id]" target="_blank" rel="noopener" :title="file.name"><img :src="urls[file.id]" :alt="file.name" loading="lazy" /></a>
      <video v-else-if="kind(file) === 'video' && urls[file.id]" class="message-video" :src="urls[file.id]" controls preload="metadata" :aria-label="file.name"></video>
      <button v-else type="button" class="message-file" :aria-label="t('responses.download', { name: file.name })" @click="download(file)">
        <AppIcon name="file" :size="16" /><span class="message-file-name">{{ file.name }}<small>{{ formatBytes(file.size) }}</small></span><AppIcon name="download" :size="14" />
      </button>
    </template>
  </div>
</template>
