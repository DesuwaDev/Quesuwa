<script setup>
import { t, languageHeaders, apiError, displayError } from './i18n.js';
import { visibleFields, inputTypes, answerError } from './form-rules.js';
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';

const props = defineProps({ form: { type: Object, required: true }, preview: Boolean });
const emit = defineEmits(['submitted']);

const answers = reactive({});
const uploads = reactive({});
const errors = reactive({});
const busy = ref(false), error = ref(''), website = ref(''), consent = ref(false);
const activeFields = computed(() => visibleFields(props.form.fields, answers));

const requiredCount = computed(() => activeFields.value.filter(f => f.required).length);
const completed = computed(() => activeFields.value.filter(f => f.required && (f.type === 'file' ? uploads[f.id]?.length : Array.isArray(answers[f.id]) ? answers[f.id].length : String(answers[f.id] ?? '').trim())).length);

function clearFiles() {
  for (const items of Object.values(uploads)) {
    for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
  }
}

watch(() => props.form.id, () => {
  clearFiles();
  for (const key of Object.keys(answers)) delete answers[key];
  for (const key of Object.keys(uploads)) delete uploads[key];
});

onBeforeUnmount(clearFiles);

function toggle(id, option, checked) {
  const current = answers[id] || [];
  answers[id] = checked ? [...current, option] : current.filter(x => x !== option);
}

function addFiles(field, list) {
  errors[field.id] = '';
  const current = uploads[field.id] || [];
  const selected = [...list];
  if (current.length + selected.length > (field.maxFiles || 3)) { errors[field.id] = 'errors.customFileLimit'; return; }
  for (const file of selected) {
    if (file.size > (field.maxFileMB || 10) * 1024 * 1024 || file.size === 0) { errors[field.id] = 'errors.customFileLimit'; return; }
    if (!allowedFile(field, file.name)) { errors[field.id] = 'errors.clientFileType'; return; }
  }
  uploads[field.id] = [...current, ...selected.map(file => ({ file, url: /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : null }))];
}

function removeFile(id, index) {
  const [item] = uploads[id].splice(index, 1);
  if (item.url) URL.revokeObjectURL(item.url);
}

function allowedFile(field, name) {
  const group = /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : /\.pdf$/i.test(name) ? 'pdf' : /\.(txt|log)$/i.test(name) ? 'text' : '';
  return !!group && (!field.fileKinds || field.fileKinds.includes(group));
}
function acceptedFiles(field) {
  const types = { image: '.png,.jpg,.jpeg,.webp,.gif', pdf: '.pdf', text: '.txt,.log' };
  return (field.fileKinds || Object.keys(types)).map(kind => types[kind]).join(',');
}
const clearModal = ref(false);
let clearResolve = null;

function confirmClear() {
  return new Promise(resolve => {
    clearResolve = resolve;
    clearModal.value = true;
  });
}

function onClearConfirm() {
  clearModal.value = false;
  clearResolve?.(true);
}

function onClearCancel() {
  clearModal.value = false;
  clearResolve?.(false);
}

async function clearAnswers() {
  if (!(await confirmClear())) return;
  clearFiles();
  for (const collection of [answers, uploads, errors]) for (const key of Object.keys(collection)) delete collection[key];
  consent.value = false; error.value = '';
}
async function submit() {
  if (props.preview) return;
  error.value = '';
  for (const key of Object.keys(errors)) delete errors[key];
  for (const field of activeFields.value) {
    const value = field.type === 'file' ? uploads[field.id] : answers[field.id];
    if (field.required && (!value || (Array.isArray(value) ? !value.length : !String(value).trim()))) errors[field.id] = 'errors.required';
    if (!['file', 'multi'].includes(field.type)) { const invalid = answerError(field, String(value ?? '')); if (invalid) errors[field.id] = invalid; }
  }
  if (props.form.settings?.consentText && !consent.value) { error.value = apiError(null, 'errors.consent'); return; }
  if (Object.keys(errors).length) { error.value = apiError(null, 'errors.requiredRemaining'); return; }
  busy.value = true;
  try {
    const body = new FormData();
    body.append('answers', JSON.stringify(Object.fromEntries(activeFields.value.filter(f => f.type !== 'file').map(f => [f.id, answers[f.id] ?? (f.type === 'multi' ? [] : '')]))));
    body.append('consent', String(consent.value));
    body.append('version', String(props.form.version));
    body.append('website', website.value);
    for (const [id, items] of Object.entries(uploads)) {
      if (!activeFields.value.some(f => f.id === id)) continue;
      for (const { file } of items) body.append(id, file);
    }
    const response = await fetch(`/api/forms/${encodeURIComponent(props.form.slug)}/responses`, { method: 'POST', headers: languageHeaders(), body });
    const data = await response.json();
    if (!response.ok) throw apiError(data, 'errors.submit');
    emit('submitted', data);
  } catch (e) {
    error.value = e;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="questionnaire google-form-layout" @submit.prevent="submit" novalidate>
    <!-- Google Forms Header Card with Accent Banner -->
    <div class="google-header-card">
      <div class="header-accent-strip"></div>
      <div class="header-card-inner">
        <div class="eyebrow"><span class="live-dot"></span>{{ preview ? t('form.preview') : t('form.eyebrow') }}</div>
        <h1>{{ form.title || t('common.untitled') }}</h1>
        <p v-if="form.description" class="intro-copy preserve">{{ form.description }}</p>

        <!-- Google Anonymous Notification Strip -->
        <div class="google-anon-strip">
          <span class="anon-icon">🔒</span>
          <span>{{ t('form.googleAnonNotice') }}</span>
        </div>

        <div class="header-divider"></div>

        <div class="header-foot-meta">
          <span class="google-required-legend">{{ t('form.googleRequiredHint') }}</span>
          <span class="meta-tag">{{ t('common.questions', { count: form.fields.length }) }}</span>
        </div>
      </div>
    </div>

    <!-- Progress Indicator Bar -->
    <div v-if="requiredCount && form.settings?.showProgress !== false" class="progress-row" role="progressbar" :aria-valuenow="completed" :aria-valuemin="0" :aria-valuemax="requiredCount">
      <span>{{ t('form.progress', { completed, required: requiredCount }) }}</span>
      <div class="progress-track">
        <div :style="{ width: `${(completed / requiredCount) * 100}%` }"></div>
      </div>
    </div>

    <!-- Bot Trap Input -->
    <div class="trap" aria-hidden="true">
      <label>{{ t('form.website') }}<input v-model="website" tabindex="-1" autocomplete="off" /></label>
    </div>

    <!-- Question Cards Stream (Google Forms Style) -->
    <fieldset
      v-for="(field, index) in activeFields"
      :key="field.id"
      class="question-card google-question-card"
      :disabled="busy"
    >
      <legend>
        <span class="question-number">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="field-title">
          {{ field.label }}
          <span v-if="field.required" class="required-asterisk">*</span>
        </span>
        <span v-if="!field.required" class="optional-tag">{{ t('common.optional') }}</span>
      </legend>

      <p v-if="field.description" class="hint preserve" :id="`hint-${field.id}`">{{ field.description }}</p>

      <!-- Short Text Input -->
      <input
        v-if="inputTypes[field.type] && field.type !== 'rating'"
        :type="inputTypes[field.type]"
        :value="answers[field.id]"
        @input="answers[field.id] = $event.target.value"
        :min="field.min"
        :max="field.max"
        step="any"
        class="google-input"
        :aria-label="field.label"
        :aria-describedby="field.description ? `hint-${field.id}` : undefined"
        :aria-required="field.required"
        :aria-invalid="!!errors[field.id]"
        :maxlength="field.maxLength || 1000"
        :placeholder="field.placeholder || t('form.shortPlaceholder')"
      />

      <!-- Long Text Textarea -->
      <textarea
        v-else-if="field.type === 'long'"
        v-model="answers[field.id]"
        class="google-textarea"
        :aria-label="field.label"
        :aria-describedby="field.description ? `hint-${field.id}` : undefined"
        :aria-required="field.required"
        :aria-invalid="!!errors[field.id]"
        :maxlength="field.maxLength || 10000"
        rows="4"
        :placeholder="field.placeholder || t('form.longPlaceholder')"
      ></textarea>

      <div v-else-if="field.type === 'rating'" class="rating-options">
        <label v-for="number in (field.ratingMax || 5)" :key="number" class="rating-option" :class="{ selected: answers[field.id] === String(number) }"><input type="radio" :name="field.id" :value="String(number)" v-model="answers[field.id]" /><span>{{ number }}</span></label>
      </div>

      <!-- Single / Multi Choices (Google Forms Radio & Checkbox) -->
      <div v-else-if="field.type === 'single' || field.type === 'multi'" class="choices google-choices">
        <label
          v-for="option in field.options"
          :key="option"
          class="choice google-choice-item"
          :class="{ selected: field.type === 'single' ? answers[field.id] === option : answers[field.id]?.includes(option) }"
        >
          <div class="choice-control">
            <input
              v-if="field.type === 'single'"
              type="radio"
              :name="field.id"
              :value="option"
              v-model="answers[field.id]"
            />
            <input
              v-else
              type="checkbox"
              :checked="answers[field.id]?.includes(option) || false"
              @change="toggle(field.id, option, $event.target.checked)"
            />
          </div>
          <span class="choice-text">{{ option }}</span>
        </label>
      </div>

      <!-- Select Dropdown -->
      <select
        v-else-if="field.type === 'select'"
        v-model="answers[field.id]"
        class="google-select"
        :aria-label="field.label"
        :aria-required="field.required"
        :aria-invalid="!!errors[field.id]"
      >
        <option :value="undefined" disabled>{{ t('form.select') }}</option>
        <option v-for="option in field.options" :key="option">{{ option }}</option>
      </select>

      <!-- File Upload Field -->
      <div v-else-if="field.type === 'file'" class="file-field">
        <label class="upload-zone google-upload-zone" @dragover.prevent @drop.prevent="addFiles(field, $event.dataTransfer.files)">
          <span class="upload-symbol">↥</span>
          <strong>{{ t('form.upload') }}</strong>
          <span>{{ t('settings.fileHint', { count: field.maxFiles || 3, size: field.maxFileMB || 10 }) }}</span>
          <input
            type="file"
            multiple
            :accept="acceptedFiles(field)"
            :aria-label="field.label"
            @change="addFiles(field, $event.target.files); $event.target.value = ''"
          />
        </label>
        <ul v-if="uploads[field.id]?.length" class="file-list">
          <li v-for="(item, i) in uploads[field.id]" :key="i">
            <img v-if="item.url" :src="item.url" :alt="t('form.attachmentPreview')" />
            <span v-else class="file-icon">↗</span>
            <span class="file-label">
              {{ item.file.name }}
              <small>{{ t('common.fileSize', { size: (item.file.size / 1024).toFixed(1) }) }}</small>
            </span>
            <button
              type="button"
              class="icon-button danger"
              :aria-label="t('form.removeFile', { name: item.file.name })"
              @click="removeFile(field.id, i)"
            >×</button>
          </li>
        </ul>
      </div>

      <!-- Field Error Alert -->
      <p v-if="errors[field.id]" class="error" role="alert">{{ t(errors[field.id]) }}</p>
    </fieldset>

    <div v-if="form.settings?.consentText" class="panel consent-panel"><p class="preserve">{{ form.settings.consentText }}</p><label class="check-row"><input type="checkbox" v-model="consent" />{{ t('settings.consentAccept') }}</label></div>

    <!-- Google Forms Bottom Submit Area -->
    <div class="submit-area google-submit-area">
      <p v-if="error" class="error submit-error" role="alert">{{ displayError(error) }}</p>
      <div class="submit-actions">
        <button class="text-button" type="button" @click="clearAnswers" :disabled="busy">{{ t('settings.clear') }}</button>
        <button class="button primary submit-button google-submit-button" :disabled="busy || preview" type="submit">
          <span>{{ preview ? t('form.previewSubmit') : busy ? t('form.submitting') : form.settings?.submitLabel || t('form.submit') }}</span>
          <span class="submit-icon" v-if="!busy">↗</span>
        </button>
      </div>
      <p class="muted small">{{ t('form.privacy') }}</p>
    </div>

    <!-- Clear Answers Custom Confirmation Modal -->
    <Teleport to="body">
      <div v-if="clearModal" class="modal-backdrop" @click.self="onClearCancel">
        <div class="modal-dialog" role="dialog" aria-modal="true" @keydown.esc="onClearCancel">
          <div class="modal-header">
            <span class="modal-icon-badge danger">!</span>
            <h2>{{ t('settings.clear') }}</h2>
          </div>
          <div class="modal-body">
            <p>{{ t('settings.clearConfirm') }}</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="button" @click="onClearCancel">
              {{ t('common.cancel') }}
            </button>
            <button type="button" class="button danger" @click="onClearConfirm">
              {{ t('settings.clear') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </form>
</template>
