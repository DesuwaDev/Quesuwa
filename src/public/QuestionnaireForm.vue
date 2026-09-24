<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { t, locale, displayError } from '../i18n.js';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { notify } from '../lib/feedback.js';
import { formatDate } from '../lib/format.js';
import { visibleFields, paginate, checkAnswer } from '../../shared/answers.js';
import { answerable } from '../../shared/schema.js';
import AppIcon from '../components/AppIcon.vue';
import QuestionField from './QuestionField.vue';

const props = defineProps({ form: { type: Object, required: true }, preview: Boolean, accessCode: String });
const emit = defineEmits(['submitted', 'expired']);

const settings = computed(() => props.form.settings || {});
const draftKey = computed(() => 'quesuwa.draft.' + props.form.id);
const canSaveDraft = computed(() => !props.preview && settings.value.saveProgress !== false);
const state = reactive({ answers: {}, others: {}, uploads: {}, errors: {} });
const pageIndex = ref(0), busy = ref(false), formError = ref(null), consent = ref(false), website = ref(''), restored = ref(false);
const root = ref(null);
const seed = String(Math.random());
const started = Date.now();

function reset() {
  for (const url of Object.values(state.uploads).flat().map(item => item.url).filter(Boolean)) URL.revokeObjectURL(url);
  state.answers = {};
  state.uploads = {};
  state.errors = {};
  state.others = Object.fromEntries(props.form.fields.filter(field => field.allowOther).map(field => [field.id, { selected: false, text: '' }]));
  pageIndex.value = 0;
  consent.value = false;
  formError.value = null;
}
reset();

// Restores answers saved in this browser for the same questionnaire version.
if (canSaveDraft.value) {
  const draft = storage.getJSON(draftKey.value);
  if (draft?.version === props.form.version && draft.answers && typeof draft.answers === 'object') {
    state.answers = draft.answers;
    for (const [id, other] of Object.entries(draft.others || {})) if (state.others[id]) state.others[id] = { selected: Boolean(other.selected), text: String(other.text || '') };
    restored.value = Object.keys(draft.answers).length > 0;
  }
}

let saveTimer = null;
watch(() => [state.answers, state.others], () => {
  if (!canSaveDraft.value) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.setJSON(draftKey.value, { version: props.form.version, answers: state.answers, others: state.others, savedAt: new Date().toISOString() }), 400);
}, { deep: true });
onBeforeUnmount(() => {
  clearTimeout(saveTimer);
  for (const url of Object.values(state.uploads).flat().map(item => item.url).filter(Boolean)) URL.revokeObjectURL(url);
});

// The effective answer merges "other" free text into choice answers.
function valueFor(field) {
  const value = state.answers[field.id];
  const other = state.others[field.id];
  if (field.type === 'single') return other?.selected ? other.text : value ?? '';
  if (field.type === 'multi') {
    const list = Array.isArray(value) ? value : [];
    return other?.selected && other.text.trim() ? [...list, other.text] : list;
  }
  return value;
}

const probe = computed(() => Object.fromEntries(props.form.fields.map(field => [field.id, field.type === 'file' ? state.uploads[field.id]?.length || 0 : valueFor(field)])));
const visible = computed(() => visibleFields(props.form.fields, probe.value));
const pages = computed(() => paginate(visible.value));
const current = computed(() => pages.value[Math.min(pageIndex.value, pages.value.length - 1)]);
const isLast = computed(() => pageIndex.value >= pages.value.length - 1);
const questions = computed(() => visible.value.filter(answerable));
const numbers = computed(() => settings.value.showNumbers === false ? {} : Object.fromEntries(questions.value.map((field, index) => [field.id, index + 1])));
const answeredCount = computed(() => questions.value.filter(field => {
  const value = probe.value[field.id];
  if (field.type === 'file') return value > 0;
  if (field.type === 'matrix') return Array.isArray(value) && value.some(Boolean);
  return Array.isArray(value) ? value.length > 0 : String(value ?? '').trim() !== '';
}).length);
const progress = computed(() => questions.value.length ? Math.round((answeredCount.value / questions.value.length) * 100) : 0);
const minutes = computed(() => Math.max(1, Math.round(props.form.fields.filter(answerable).length * 20 / 60)));

watch(pages, value => { if (pageIndex.value > value.length - 1) pageIndex.value = Math.max(0, value.length - 1); });

// Option conditions can hide a choice that was already picked; drop it so the
// answer and anything that depends on it stay consistent.
watch(visible, fields => {
  for (const field of fields) {
    if (!field.hiddenOptions?.length) continue;
    const value = state.answers[field.id];
    if (Array.isArray(value)) {
      const kept = value.filter(item => !field.hiddenOptions.includes(item));
      if (kept.length !== value.length) state.answers[field.id] = kept;
    } else if (typeof value === 'string' && field.hiddenOptions.includes(value)) state.answers[field.id] = '';
  }
}, { immediate: true });

function validate(fields) {
  let first = null;
  for (const field of fields) {
    delete state.errors[field.id];
    if (!answerable(field)) continue;
    let error = null;
    if (field.type === 'file') {
      if (field.required && !(state.uploads[field.id]?.length)) error = { code: 'errors.required', params: {} };
    } else if (state.others[field.id]?.selected && !state.others[field.id].text.trim()) {
      error = { code: 'errors.otherEmpty', params: {} };
    } else {
      const result = checkAnswer(field, valueFor(field));
      if (result.error) error = { code: result.error, params: result.params || {} };
    }
    if (error) {
      state.errors[field.id] = error;
      first ??= field.id;
    }
  }
  return first;
}

async function focusField(id) {
  await nextTick();
  const element = root.value?.querySelector(`[data-field="${CSS.escape(id)}"]`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element?.querySelector('input:not([type=hidden]), textarea, select, button')?.focus({ preventScroll: true });
}

async function goTo(index) {
  pageIndex.value = index;
  formError.value = null;
  await nextTick();
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  root.value?.querySelector('.page-heading-focus')?.focus({ preventScroll: true });
}

function next() {
  const invalid = validate(current.value.fields);
  if (invalid) { formError.value = { code: 'errors.pageIncomplete', params: {} }; focusField(invalid); return; }
  goTo(pageIndex.value + 1);
}

const previous = () => goTo(Math.max(0, pageIndex.value - 1));

function pageOf(fieldId) {
  return pages.value.findIndex(page => page.fields.some(field => field.id === fieldId));
}

async function submit() {
  if (!isLast.value) return next();
  formError.value = null;
  const invalid = validate(visible.value);
  if (invalid) {
    const index = pageOf(invalid);
    if (index >= 0 && index !== pageIndex.value) pageIndex.value = index;
    formError.value = { code: 'errors.requiredRemaining', params: {} };
    return focusField(invalid);
  }
  if (settings.value.consentText && !consent.value) { formError.value = { code: 'errors.consent', params: {} }; return; }
  if (props.preview) { notify('form.previewValid', { type: 'info' }); return; }
  busy.value = true;
  try {
    const body = new FormData();
    const answers = Object.fromEntries(questions.value.filter(field => field.type !== 'file').map(field => [field.id, valueFor(field) ?? '']));
    body.append('answers', JSON.stringify(answers));
    body.append('version', String(props.form.version));
    body.append('consent', String(consent.value));
    body.append('website', website.value);
    body.append('duration', String(Date.now() - started));
    body.append('locale', locale.value);
    if (props.accessCode) body.append('accessCode', props.accessCode);
    for (const field of questions.value) {
      if (field.type !== 'file') continue;
      for (const { file } of state.uploads[field.id] || []) body.append(field.id, file);
    }
    const data = await api('/forms/' + encodeURIComponent(props.form.slug) + '/responses', { method: 'POST', body });
    storage.remove(draftKey.value);
    emit('submitted', data);
  } catch (error) {
    formError.value = error;
    const fieldId = error.params?.fieldId;
    if (fieldId && props.form.fields.some(field => field.id === fieldId)) {
      state.errors[fieldId] = { code: error.code, params: error.params };
      const index = pageOf(fieldId);
      if (index >= 0) pageIndex.value = index;
      focusField(fieldId);
    }
  } finally { busy.value = false; }
}

function discardDraft() {
  storage.remove(draftKey.value);
  reset();
  restored.value = false;
}
const outdated = computed(() => ['errors.versionConflict', 'errors.formChanged'].includes(formError.value?.code));
</script>

<template>
  <form ref="root" class="questionnaire" novalidate @submit.prevent="submit">
    <header class="form-hero">
      <span class="form-hero-strip"></span>
      <div class="form-hero-body">
        <span class="eyebrow"><span class="live-dot"></span>{{ preview ? t('form.preview') : t('form.eyebrow') }}</span>
        <h1>{{ form.title || t('common.untitled') }}</h1>
        <p v-if="form.description" class="form-intro preserve">{{ form.description }}</p>
        <div class="form-meta">
          <span><AppIcon name="forms" :size="14" />{{ t('common.questions', { count: questions.length }) }}</span>
          <span><AppIcon name="clock" :size="14" />{{ t('form.estimate', { minutes }) }}</span>
          <span v-if="settings.endsAt"><AppIcon name="calendar" :size="14" />{{ t('portal.endsAt', { date: formatDate(settings.endsAt) }) }}</span>
          <span><AppIcon name="shield" :size="14" />{{ t('form.anonymous') }}</span>
        </div>
        <p class="required-legend"><span class="required-mark">*</span>{{ t('form.requiredLegend') }}</p>
      </div>
    </header>

    <div v-if="restored" class="draft-banner" role="status">
      <AppIcon name="restore" :size="16" />
      <span>{{ t('form.draftRestored') }}</span>
      <button type="button" class="text-button small" @click="discardDraft">{{ t('form.draftDiscard') }}</button>
    </div>

    <div v-if="settings.showProgress !== false && questions.length" class="progress-sticky">
      <div class="progress-info">
        <span v-if="pages.length > 1">{{ t('form.pageOf', { page: pageIndex + 1, pages: pages.length }) }}</span>
        <span>{{ t('form.progress', { percent: progress }) }}</span>
      </div>
      <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="t('form.progressLabel')"><span :style="{ width: progress + '%' }"></span></div>
    </div>

    <div class="trap" aria-hidden="true"><label>{{ t('form.website') }}<input v-model="website" tabindex="-1" autocomplete="off" /></label></div>

    <Transition name="page" mode="out-in">
      <section :key="pageIndex" class="form-page-body">
        <div v-if="current.section" class="section-heading-card">
          <h2 class="page-heading-focus" tabindex="-1">{{ current.section.label }}</h2>
          <p v-if="current.section.description" class="preserve">{{ current.section.description }}</p>
        </div>
        <span v-else class="page-heading-focus sr-only" tabindex="-1">{{ t('form.pageOf', { page: pageIndex + 1, pages: pages.length }) }}</span>
        <p v-if="!current.fields.length" class="muted center">{{ t('form.emptyPage') }}</p>
        <QuestionField v-for="field in current.fields" :key="field.id" :field="field" :number="numbers[field.id]" :state="state" :seed="seed" :disabled="busy" />
      </section>
    </Transition>

    <div v-if="isLast && settings.consentText" class="consent-card">
      <p class="preserve">{{ settings.consentText }}</p>
      <label class="check-row"><input v-model="consent" type="checkbox" :disabled="busy" />{{ t('form.consentAccept') }}</label>
    </div>

    <div class="form-footer">
      <p v-if="formError" class="form-error" role="alert">
        <AppIcon name="alert" :size="16" />
        <span>{{ displayError(formError) }}</span>
        <button v-if="outdated" type="button" class="text-button small" @click="emit('expired')">{{ t('form.reload') }}</button>
      </p>
      <div class="form-nav">
        <button v-if="pageIndex > 0" type="button" class="button" :disabled="busy" @click="previous"><AppIcon name="arrowLeft" :size="16" />{{ t('form.previous') }}</button>
        <span class="spacer"></span>
        <button v-if="!isLast" type="submit" class="button primary">{{ t('form.next') }}<AppIcon name="arrowRight" :size="16" /></button>
        <button v-else type="submit" class="button primary submit-button" :disabled="busy">
          <span v-if="busy" class="spinner small"></span>
          {{ busy ? t('form.submitting') : settings.submitLabel || t('form.submit') }}
        </button>
      </div>
      <p class="form-privacy"><AppIcon name="lock" :size="13" />{{ preview ? t('form.previewNote') : t('form.privacy') }}</p>
    </div>
  </form>
</template>
