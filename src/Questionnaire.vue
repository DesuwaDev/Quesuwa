<script setup>
import { t, languageHeaders, apiError, displayError } from './i18n.js';
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
const props = defineProps({ form: { type: Object, required: true }, preview: Boolean });
const emit = defineEmits(['submitted']);
const answers = reactive({});
const uploads = reactive({});
const errors = reactive({});
const busy = ref(false), error = ref(''), website = ref('');
const requiredCount = computed(() => props.form.fields.filter(f => f.required).length);
const completed = computed(() => props.form.fields.filter(f => f.required && (f.type === 'file' ? uploads[f.id]?.length : Array.isArray(answers[f.id]) ? answers[f.id].length : answers[f.id]?.trim())).length);
function clearFiles() { for (const items of Object.values(uploads)) for (const item of items) if (item.url) URL.revokeObjectURL(item.url); }
watch(() => props.form.id, () => { clearFiles(); for (const key of Object.keys(answers)) delete answers[key]; for (const key of Object.keys(uploads)) delete uploads[key]; });
onBeforeUnmount(clearFiles);
function toggle(id, option, checked) {
  const current = answers[id] || [];
  answers[id] = checked ? [...current, option] : current.filter(x => x !== option);
}
function addFiles(field, list) {
  errors[field.id] = '';
  const current = uploads[field.id] || [];
  const selected = [...list];
  if (current.length + selected.length > 3) { errors[field.id] = 'errors.clientFileCount'; return; }
  for (const file of selected) {
    if (file.size > 10 * 1024 * 1024 || file.size === 0) { errors[field.id] = 'errors.clientFileSize'; return; }
    if (!/\.(png|jpe?g|webp|gif|pdf|txt|log)$/i.test(file.name)) { errors[field.id] = 'errors.clientFileType'; return; }
  }
  uploads[field.id] = [...current, ...selected.map(file => ({ file, url: /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : null }))];
}
function removeFile(id, index) { const [item] = uploads[id].splice(index, 1); if (item.url) URL.revokeObjectURL(item.url); }
async function submit() {
  if (props.preview) return;
  error.value = '';
  for (const key of Object.keys(errors)) delete errors[key];
  for (const field of props.form.fields) {
    const value = field.type === 'file' ? uploads[field.id] : answers[field.id];
    if (field.required && (!value || (Array.isArray(value) ? !value.length : !value.trim()))) errors[field.id] = 'errors.required';
  }
  if (Object.keys(errors).length) { error.value = apiError(null, 'errors.requiredRemaining'); return; }
  busy.value = true;
  try {
    const body = new FormData();
    body.append('answers', JSON.stringify(answers)); body.append('version', String(props.form.version)); body.append('website', website.value);
    for (const [id, items] of Object.entries(uploads)) for (const { file } of items) body.append(id, file);
    const response = await fetch(`/api/forms/${encodeURIComponent(props.form.slug)}/responses`, { method: 'POST', headers: languageHeaders(), body });
    const data = await response.json();
    if (!response.ok) throw apiError(data, 'errors.submit');
    emit('submitted', data);
  } catch (e) { error.value = e; } finally { busy.value = false; }
}
</script>

<template>
  <form class="questionnaire" @submit.prevent="submit" novalidate>
    <div class="form-intro">
      <div class="eyebrow"><span class="live-dot"></span>{{ preview ? t('form.preview') : t('form.eyebrow') }}</div>
      <h1>{{ form.title || t('common.untitled') }}</h1>
      <p class="intro-copy preserve">{{ form.description }}</p>
      <div class="form-meta"><span>{{ t('form.anonymous') }}</span><span>{{ t('common.questions', { count: form.fields.length }) }}</span><span>{{ t('common.requiredCount', { count: requiredCount }) }}</span></div>
    </div>
    <div v-if="requiredCount" class="progress-row"><span>{{ t('form.progress', { completed, required: requiredCount }) }}</span><div class="progress-track"><div :style="{ width: `${completed / requiredCount * 100}%` }"></div></div></div>
    <div class="trap" aria-hidden="true"><label>{{ t('form.website') }}<input v-model="website" tabindex="-1" autocomplete="off" /></label></div>
    <fieldset v-for="(field, index) in form.fields" :key="field.id" class="question-card" :disabled="busy">
      <legend><span class="question-number">{{ String(index + 1).padStart(2, '0') }}</span><span>{{ field.label }}</span><span class="require-tag">{{ field.required ? t('common.required') : t('common.optional') }}</span></legend>
      <p v-if="field.description" class="hint preserve" :id="`hint-${field.id}`">{{ field.description }}</p>
      <input v-if="field.type === 'short'" v-model="answers[field.id]" :aria-label="field.label" :aria-describedby="`hint-${field.id}`" :aria-required="field.required" :aria-invalid="!!errors[field.id]" maxlength="1000" :placeholder="t('form.shortPlaceholder')" />
      <textarea v-else-if="field.type === 'long'" v-model="answers[field.id]" :aria-label="field.label" :aria-describedby="`hint-${field.id}`" :aria-required="field.required" :aria-invalid="!!errors[field.id]" maxlength="10000" rows="4" :placeholder="t('form.longPlaceholder')"></textarea>
      <div v-else-if="field.type === 'single' || field.type === 'multi'" class="choices">
        <label v-for="option in field.options" :key="option" class="choice" :class="{ selected: field.type === 'single' ? answers[field.id] === option : answers[field.id]?.includes(option) }">
          <input v-if="field.type === 'single'" type="radio" :name="field.id" :value="option" v-model="answers[field.id]" />
          <input v-else type="checkbox" :checked="answers[field.id]?.includes(option) || false" @change="toggle(field.id, option, $event.target.checked)" />
          <span>{{ option }}</span>
        </label>
      </div>
      <select v-else-if="field.type === 'select'" v-model="answers[field.id]" :aria-label="field.label"><option :value="undefined" disabled>{{ t('form.select') }}</option><option v-for="option in field.options" :key="option">{{ option }}</option></select>
      <div v-else-if="field.type === 'file'">
        <label class="upload-zone" @dragover.prevent @drop.prevent="addFiles(field, $event.dataTransfer.files)">
          <span class="upload-symbol">↥</span><strong>{{ t('form.upload') }}</strong><span>{{ t('form.uploadHint') }}</span>
          <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.log" :aria-label="field.label" @change="addFiles(field, $event.target.files); $event.target.value = ''" />
        </label>
        <ul v-if="uploads[field.id]?.length" class="file-list"><li v-for="(item, i) in uploads[field.id]" :key="i"><img v-if="item.url" :src="item.url" :alt="t('form.attachmentPreview')" /><span v-else class="file-icon">↗</span><span class="file-label">{{ item.file.name }}<small>{{ t('common.fileSize', { size: (item.file.size / 1024).toFixed(1) }) }}</small></span><button type="button" class="icon-button" :aria-label="t('form.removeFile', { name: item.file.name })" @click="removeFile(field.id, i)">×</button></li></ul>
      </div>
      <p v-if="errors[field.id]" class="error" role="alert">{{ t(errors[field.id]) }}</p>
    </fieldset>
    <div class="submit-area"><p v-if="error" class="error" role="alert">{{ displayError(error) }}</p><button class="button primary submit-button" :disabled="busy || preview" type="submit">{{ preview ? t('form.previewSubmit') : busy ? t('form.submitting') : t('form.submit') }} <span v-if="!busy">↗</span></button><p class="muted small">{{ t('form.privacy') }}</p></div>
  </form>
</template>
