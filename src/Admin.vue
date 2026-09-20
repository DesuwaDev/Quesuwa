<script setup>
import { t, locale, languageHeaders, apiError, displayError, transitionView } from './i18n.js';
import { computed, onMounted, ref, onUnmounted } from 'vue';
import Questionnaire from './Questionnaire.vue';
import SurveySettings from './SurveySettings.vue';
import FieldSettings from './FieldSettings.vue';
import AdminInsights from './AdminInsights.vue';
import SystemPanel from './SystemPanel.vue';
import { defaultSettings, normalizeRules } from './form-rules.js';
import LanguageSwitcher from './LanguageSwitcher.vue';
import { fieldTypes, choiceTypes, statuses, statusKeys, stateKeys } from './shared.js';

const logged = ref(false), checking = ref(true), password = ref(''), busy = ref(false), error = ref(''), notice = ref('');
const forms = ref([]), draft = ref(null), original = ref(''), view = ref('forms'), preview = ref(false);
const responseForm = ref(null), responses = ref([]), total = ref(0), page = ref(1), filter = ref(''), selected = ref(null);
const editorTab = ref('questions');
const newFieldDefaults = new Map();
const trash = ref(false), search = ref(''), stateFilter = ref(''), sort = ref('updated');
const responseSearch = ref(''), responseTrash = ref(false), checked = ref([]), batchStatus = ref('pending');
const statistics = ref(null), system = ref(null), sessions = ref([]);
const filteredForms = computed(() => forms.value.filter(form => (!stateFilter.value || form.state === stateFilter.value) && (form.title + form.slug).toLocaleLowerCase().includes(search.value.toLocaleLowerCase())).sort((a, b) => sort.value === 'responses' ? b.responseCount - a.responseCount : (sort.value === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt))));
const formsPage = ref(1);
const formsPageSize = ref(8);
const formsTotalPages = computed(() => Math.max(1, Math.ceil(filteredForms.value.length / formsPageSize.value)));
const paginatedForms = computed(() => {
  const max = formsTotalPages.value;
  const current = Math.min(Math.max(1, formsPage.value), max);
  const start = (current - 1) * formsPageSize.value;
  return filteredForms.value.slice(start, start + formsPageSize.value);
});

const modal = ref({
  open: false,
  title: '',
  message: '',
  prompt: false,
  promptValue: '',
  expected: '',
  danger: true,
  confirmText: '',
  resolve: null
});

function confirmDialog({ title, message, danger = true, confirmText = '' }) {
  return new Promise(resolve => {
    modal.value = {
      open: true,
      title,
      message,
      prompt: false,
      promptValue: '',
      expected: '',
      danger,
      confirmText,
      resolve
    };
  });
}

function promptDialog({ title, message, expected = '', danger = true, confirmText = '' }) {
  return new Promise(resolve => {
    modal.value = {
      open: true,
      title,
      message,
      prompt: true,
      promptValue: '',
      expected,
      danger,
      confirmText,
      resolve
    };
  });
}

function confirmModalSubmit() {
  if (modal.value.prompt && modal.value.expected && modal.value.promptValue !== modal.value.expected) return;
  const resolve = modal.value.resolve;
  modal.value.open = false;
  resolve?.(modal.value.prompt ? modal.value.promptValue : true);
}

function confirmModalCancel() {
  const resolve = modal.value.resolve;
  modal.value.open = false;
  resolve?.(modal.value.prompt ? '' : false);
}

const clone = value => JSON.parse(JSON.stringify(value));
const dirty = computed(() => view.value === 'editor' && draft.value && JSON.stringify(draft.value) !== original.value);
const count = computed(() => forms.value.reduce((sum, f) => sum + (f.responseCount || 0), 0));
const formUrl = computed(() => draft.value ? `${window.location.origin}/f/${draft.value.slug}` : '');

async function api(url, options = {}) {
  const res = await fetch('/api' + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...languageHeaders(),
      ...options.headers
    }
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) logged.value = false;
    throw apiError(data, 'errors.operation');
  }
  return data;
}

async function run(action) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
  } catch (e) {
    error.value = e;
  } finally {
    busy.value = false;
  }
}

async function loadForms() {
  formsPage.value = 1;
  forms.value = await api(`/admin/forms?trash=${trash.value}`);
}

const navigationId = crypto.randomUUID();
let navigationIndex = 0;
let restoringNavigation = false;

function navigationState() {
  return { navigationId, navigationIndex, view: view.value, preview: preview.value, editorTab: editorTab.value };
}

function recordNavigation() {
  navigationIndex += 1;
  window.history.pushState(navigationState(), '', window.location.href);
}

async function onHistoryBack(event) {
  if (restoringNavigation) {
    restoringNavigation = false;
    return;
  }
  const target = event.state;
  if (target?.navigationId !== navigationId) return;
  if (view.value === 'editor' && target.view !== 'editor' && dirty.value) {
    if (Boolean(globalThis.document)) {
      const ok = await confirmDialog({
        title: t('common.confirm'),
        message: t('admin.unsavedConfirm'),
        danger: true
      });
      if (!ok) {
        restoringNavigation = true;
        window.history.go(navigationIndex - target.navigationIndex);
        return;
      }
    } else if (!window.confirm(t('admin.unsavedConfirm'))) {
      restoringNavigation = true;
      window.history.go(navigationIndex - target.navigationIndex);
      return;
    }
  }
  transitionView(() => {
    navigationIndex = target.navigationIndex;
    view.value = logged.value && (target.view !== 'editor' || draft.value) ? target.view : 'forms';
    editorTab.value = target.editorTab || 'questions';
    preview.value = view.value === 'editor' && target.preview;
    error.value = '';
    notice.value = '';
    if (view.value === 'forms' && logged.value) run(loadForms);
  });
}

function switchEditorTab(value) { if (editorTab.value === value) return; transitionView(() => { editorTab.value = value; recordNavigation(); }); }

function togglePreview() {
  if (preview.value) {
    window.history.back();
    return;
  }
  transitionView(() => {
    preview.value = true;
    recordNavigation();
  });
}

onUnmounted(() => window.removeEventListener('popstate', onHistoryBack));

onMounted(async () => {
  window.history.replaceState(navigationState(), '', window.location.href);
  window.addEventListener('popstate', onHistoryBack);
  try {
    await api('/admin/session');
    logged.value = true;
    await loadForms();
  } catch (e) {
    if (logged.value) error.value = e;
  } finally {
    checking.value = false;
  }
});

function warnBeforeUnload(e) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
window.addEventListener('beforeunload', warnBeforeUnload);
onUnmounted(() => window.removeEventListener('beforeunload', warnBeforeUnload));

async function back() {
  if (dirty.value) {
    if (Boolean(globalThis.document)) {
      const ok = await confirmDialog({
        title: t('common.confirm'),
        message: t('admin.unsavedConfirm'),
        danger: true
      });
      if (!ok) return;
    } else if (!window.confirm(t('admin.unsavedConfirm'))) {
      return;
    }
  }
  transitionView(() => {
    view.value = 'forms';
    draft.value = null;
    responseForm.value = null;
    preview.value = false;
    error.value = '';
    notice.value = '';
    if (logged.value) run(loadForms);
  });
}

async function login() {
  await run(async () => {
    await api('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: password.value })
    });
    logged.value = true;
    password.value = '';
    await loadForms();
  });
}

async function logout() {
  if (dirty.value) {
    if (Boolean(globalThis.document)) {
      const ok = await confirmDialog({
        title: t('common.confirm'),
        message: t('admin.unsavedConfirm'),
        danger: true
      });
      if (!ok) return;
    } else if (!window.confirm(t('admin.unsavedConfirm'))) {
      return;
    }
  }
  await run(async () => {
    await api('/admin/logout', { method: 'POST', body: '{}' });
    logged.value = false;
    draft.value = null;
    selected.value = null;
    view.value = 'forms';
  });
}

function edit(form) {
  transitionView(() => {
    newFieldDefaults.clear();
    editorTab.value = 'questions';
    draft.value = clone(form);
    draft.value.settings = { ...defaultSettings, ...draft.value.settings };
    draft.value.fields = draft.value.fields.map((field, index) => ({ ...normalizeRules(field, draft.value.fields.slice(0, index)), ...field }));
    original.value = JSON.stringify(draft.value);
    preview.value = false;
    view.value = 'editor';
    recordNavigation();
    error.value = '';
    notice.value = '';
  });
}

function create() {
  edit({
    title: t('common.untitled'), description: '', thanks: t('common.thanks'), fields: [],
    slug: `survey-${crypto.randomUUID().slice(0, 8)}`,
    state: 'draft'
  });
}

function addField(type) {
  const field = {
    id: crypto.randomUUID(),
    type,
    label: t('editor.newField', { type: t(fieldTypes[type]) }),
    description: '',
    required: false, placeholder: '', maxLength: type === 'long' ? 10000 : 1000, min: null, max: null, maxFiles: 3, maxFileMB: 10, fileKinds: ['image', 'pdf', 'text'], ratingMax: 5, condition: null,
    options: choiceTypes.includes(type) ? [t('editor.optionNumber', { number: 1 }), t('editor.optionNumber', { number: 2 })] : []
  };
  newFieldDefaults.set(field.id, { label: field.label, options: [...field.options] });
  draft.value.fields.push(field);
}

function changeType(field) {
  field.maxLength = field.type === 'long' ? 10000 : 1000;
  repairConditions();
  if (choiceTypes.includes(field.type) && !field.options.length) {
    field.options = [t('editor.optionNumber', { number: 1 }), t('editor.optionNumber', { number: 2 })];
  }
}

function move(index, delta) {
  const fields = draft.value.fields;
  const [f] = fields.splice(index, 1);
  fields.splice(index + delta, 0, f);
  repairConditions();
}

async function remove(index) {
  const field = draft.value.fields[index];
  if (!field) return;
  const defaults = newFieldDefaults.get(field.id);
  const hasContent = (field.label.trim() && field.label.trim() !== defaults?.label)
    || field.description?.trim() || field.placeholder?.trim()
    || field.options?.some(option => option.trim() && !defaults?.options.includes(option.trim()));
  const confirmed = !hasContent || await confirmDialog({
    title: t('editor.remove'),
    message: t('admin.removeConfirm'),
    danger: true,
    confirmText: t('editor.remove')
  });
  if (confirmed) {
    const currentIndex = draft.value.fields.findIndex(item => item.id === field.id);
    if (currentIndex === -1) return;
    draft.value.fields.splice(currentIndex, 1);
    newFieldDefaults.delete(field.id);
    repairConditions();
  }
}

function repairConditions() {
  for (const [index, field] of draft.value.fields.entries()) {
    if (!field.condition) continue;
    const parent = draft.value.fields.slice(0, index).find(f => f.id === field.condition.fieldId && choiceTypes.includes(f.type));
    if (!parent || !parent.options.includes(field.condition.value)) field.condition = null;
  }
}
function duplicateField(index) {
  const field = clone(draft.value.fields[index]);
  if (draft.value.fields.length >= 30 || (field.type === 'file' && draft.value.fields.filter(f => f.type === 'file').length >= 2)) return;
  field.id = crypto.randomUUID();
  draft.value.fields.splice(index + 1, 0, field);
}
async function switchTrash(value) {
  formsPage.value = 1;
  transitionView(() => { trash.value = value; });
  await run(async () => { forms.value = await api(`/admin/forms?trash=${value}`); });
}
async function duplicateForm(form) {
  await run(async () => { const copy = await api(`/admin/forms/${form.id}/duplicate`, { method: 'POST', body: '{}' }); edit(copy); await loadForms(); });
}
async function deleteForm(form, permanent = false) {
  let confirmation = '';
  if (permanent) {
    confirmation = await promptDialog({
      title: t('manage.purge'),
      message: t('manage.purgeConfirm', { title: form.title }),
      expected: form.title,
      danger: true,
      confirmText: t('manage.purge')
    });
    if (confirmation !== form.title) return;
  } else {
    const confirmed = await confirmDialog({
      title: t('manage.delete'),
      message: t('manage.deleteConfirm', { title: form.title }),
      danger: true,
      confirmText: t('manage.delete')
    });
    if (!confirmed) return;
  }
  await run(async () => {
    await api(`/admin/forms/${form.id}?permanent=${permanent}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) });
    await loadForms();
    notice.value = 'manage.done';
  });
}
async function restoreForm(form) {
  await run(async () => { await api(`/admin/forms/${form.id}/restore`, { method: 'POST', body: '{}' }); await loadForms(); notice.value = 'manage.done'; });
}
async function importForm(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  await run(async () => {
    if (file.size > 256 * 1024) throw apiError(null, 'manage.importInvalid');
    let definition;
    try { definition = JSON.parse(await file.text()); } catch { throw apiError(null, 'manage.importInvalid'); }
    const created = await api('/admin/forms', { method: 'POST', body: JSON.stringify({ ...definition, slug: `survey-${crypto.randomUUID().slice(0, 12)}`, state: 'draft' }) });
    edit(created); await loadForms();
  });
}
async function refreshSystem() { [system.value, sessions.value] = await Promise.all([api('/admin/system'), api('/admin/sessions')]); }
function passwordChanged() { logged.value = false; draft.value = null; view.value = 'forms'; notice.value = 'account.changed'; }
async function openSystem() {
  await run(async () => { await refreshSystem(); transitionView(() => { view.value = 'system'; recordNavigation(); }); });
}
async function batchResponses(action) {
  if (!checked.value.length) return;
  let confirmation = '';
  if (action === 'trash') {
    const confirmed = await confirmDialog({
      title: t('manage.delete'),
      message: t('manage.trashResponsesConfirm', { count: checked.value.length }),
      danger: true,
      confirmText: t('manage.delete')
    });
    if (!confirmed) return;
  } else if (action === 'purge') {
    confirmation = await promptDialog({
      title: t('manage.purge'),
      message: t('manage.responsePurgeConfirm', { title: responseForm.value.title }),
      expected: responseForm.value.title,
      danger: true,
      confirmText: t('manage.purge')
    });
    if (confirmation !== responseForm.value.title) return;
  }
  await run(async () => {
    await api(`/admin/forms/${responseForm.value.id}/responses/batch`, { method: 'POST', body: JSON.stringify({ ids: checked.value, action, status: batchStatus.value, confirmation }) });
    checked.value = []; selected.value = null; page.value = 1;
    await loadResponses(); notice.value = 'manage.done';
  });
}
function selectAll(event) { checked.value = event.target.checked ? responses.value.map(item => item.id) : []; }
async function searchResponses() { page.value = 1; selected.value = null; checked.value = []; await run(loadResponses); }

async function save() {
  await run(async () => {
    repairConditions();
    const value = await api(draft.value.id ? `/admin/forms/${draft.value.id}` : '/admin/forms', {
      method: draft.value.id ? 'PUT' : 'POST',
      body: JSON.stringify(draft.value)
    });
    draft.value = value;
    original.value = JSON.stringify(value);
    await loadForms();
    notice.value = value.state === 'published' ? 'admin.savedPublished' : 'admin.saved';
  });
}

async function copyLink(slug) {
  await run(async () => {
    const link = `${window.location.origin}/f/${slug}`;
    await navigator.clipboard.writeText(link);
    notice.value = 'admin.linkCopied';
  });
}

async function loadResponses() {
  const data = await api(`/admin/forms/${responseForm.value.id}/responses?page=${page.value}&status=${encodeURIComponent(filter.value)}&q=${encodeURIComponent(responseSearch.value)}&trash=${responseTrash.value}`);
  responses.value = data.items;
  checked.value = [];
  statistics.value = await api(`/admin/forms/${responseForm.value.id}/statistics`);
  total.value = data.total;
}

async function openResponses(form) {
  responseSearch.value = ''; responseTrash.value = false; checked.value = []; statistics.value = null;
  transitionView(() => {
    responseForm.value = form;
    selected.value = null;
    page.value = 1;
    filter.value = '';
    view.value = 'responses';
    recordNavigation();
  });
  await run(loadResponses);
}

async function changePage(delta) {
  page.value += delta;
  selected.value = null;
  await run(loadResponses);
}

async function saveResponse() {
  await run(async () => {
    await api(`/admin/responses/${selected.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: selected.value.status, note: selected.value.note })
    });
    await loadResponses();
    notice.value = 'admin.reviewSaved';
  });
}

function formatDate(v) {
  return new Date(v).toLocaleString(locale.value);
}

function summary(item) {
  return item.snapshot.fields
    .filter(f => f.type !== 'file')
    .map(f => Array.isArray(item.answers[f.id]) ? item.answers[f.id].join(t('common.listSeparator')) : item.answers[f.id])
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ') || t('responses.onlyFiles');
}

function answer(item, field) {
  const value = item.answers[field.id];
  return Array.isArray(value) ? value.join(t('common.listSeparator')) || t('responses.unanswered') : value || t('responses.unanswered');
}
</script>

<template>
  <div class="admin-shell">
    <header class="admin-header">
      <a class="brand" href="/">
        <img class="brand-mark" src="/logo.png" :alt="t('app.brand')" />
        <span>
          {{ t('app.brand') }}
          <span class="brand-divider">/</span>
          <span class="brand-sub">{{ t('admin.subtitle') }}</span>
        </span>
      </a>
      <div class="header-tools">
        <button v-if="logged" class="text-button" @click="logout" :disabled="busy">{{ t('admin.logout') }}</button>
        <LanguageSwitcher />
      </div>
    </header>

    <div v-if="checking" class="state-card loading-card">
      <div class="spinner"></div>
      <p>{{ t('common.loading') }}</p>
    </div>

    <main v-else-if="!logged" class="login-wrap">
      <form id="quesuwa-admin-login" class="login-card" method="post" action="/api/admin/login" @submit.prevent="login">
        <div class="eyebrow">{{ t('public.admin') }}</div>
        <h1>{{ t('admin.welcome') }}</h1>
        <p class="muted">{{ t('admin.loginIntro') }}</p>

        <label class="stack-label" for="quesuwa-admin-password">
          <span>{{ t('admin.password') }}</span>
          <input
            id="quesuwa-admin-password"
            name="password"
            type="password"
            v-model="password"
            autocomplete="current-password"
            required
            :placeholder="t('admin.passwordPlaceholder')"
          />
        </label>

        <p v-if="notice" class="notice positive" role="status">{{ t(notice) }}</p>
        <p v-if="error" class="error" role="alert">{{ displayError(error) }}</p>
        <button class="button primary" type="submit" :disabled="busy">
          {{ busy ? t('admin.loggingIn') : t('admin.login') }}
        </button>
        <a href="/" class="muted small">{{ t('admin.fillSurvey') }}</a>
      </form>
    </main>

    <main v-else class="admin-main">
      <div class="notice error" role="alert" v-if="error">{{ displayError(error) }}</div>
      <div class="notice positive" role="status" v-if="notice">{{ t(notice) }}</div>

      <!-- FORMS DASHBOARD VIEW -->
      <div v-if="view === 'forms'" class="forms-view">
        <div class="page-heading">
          <div>
            <div class="eyebrow">{{ t('admin.eyebrow') }}</div>
            <h1>{{ t('admin.heading') }}</h1>
            <p class="muted">{{ t('admin.intro') }}</p>
          </div>
          <div class="actions">
            <label class="button import-button">{{ t('manage.import') }}<input type="file" accept=".json,application/json" @change="importForm" /></label>
            <button class="button primary" @click="create()">{{ t('admin.newSurvey') }}</button>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat-card">
            <span>{{ trash ? t('manage.trash') : t('admin.allForms') }}</span>
            <strong>{{ forms.length }}</strong>
          </div>
          <div class="stat-card">
            <span>{{ t('admin.collecting') }}</span>
            <strong>{{ forms.filter(f => !f.deletedAt && f.state === 'published').length }}</strong>
          </div>
          <div class="stat-card">
            <span>{{ t('admin.received') }}</span>
            <strong>{{ count }}</strong>
          </div>
        </div>

        <div class="management-toolbar">
          <div class="segmented-control"><button :class="{ active: !trash }" @click="switchTrash(false)" :disabled="busy">{{ t('manage.active') }}</button><button :class="{ active: trash }" @click="switchTrash(true)" :disabled="busy">{{ t('manage.trash') }}</button></div>
          <input type="search" v-model="search" @input="formsPage = 1" :placeholder="t('manage.search')" :aria-label="t('manage.search')" />
          <select v-model="stateFilter" @change="formsPage = 1" :aria-label="t('manage.allStates')"><option value="">{{ t('manage.allStates') }}</option><option v-for="(key, state) in stateKeys" :key="state" :value="state">{{ t(key) }}</option></select>
          <select v-model="sort" @change="formsPage = 1" :aria-label="t('manage.sort')"><option value="updated">{{ t('manage.updated') }}</option><option value="created">{{ t('manage.created') }}</option><option value="responses">{{ t('manage.mostResponses') }}</option></select>
          <button class="button" @click="openSystem" :disabled="busy">{{ t('manage.system') }}</button>
        </div>
        <div v-if="!filteredForms.length" class="state-card">
          <p>{{ t('manage.noMatches') }}</p>
        </div>

        <div v-else class="form-grid">
          <article v-for="form in paginatedForms" :key="form.id" class="admin-form-card">
            <div class="card-top">
              <span class="badge" :class="form.state">{{ form.deletedAt ? t('manage.trash') : t(stateKeys[form.state]) }}</span>
              <span class="muted small">{{ t('common.questions', { count: form.fields.length }) }}</span>
            </div>
            <h2>{{ form.title }}</h2>
            <p class="card-description">{{ form.description || t('admin.noDescription') }}</p>
            <div class="response-count">
              <strong>{{ form.responseCount }}</strong>{{ t('admin.responsesUnit') }}
            </div>
            <div class="card-actions">
              <button v-if="!trash" @click="edit(form)" class="button">{{ t('admin.edit') }}</button>
              <button @click="openResponses(form)" class="button">{{ t('admin.responses') }}</button>
              <button v-if="!trash && form.state === 'published'" @click="copyLink(form.slug)" class="text-button">
                {{ t('admin.copy') }}
              </button>
              <details class="card-menu"><summary>{{ t('manage.action') }}</summary><div class="card-menu-items">
                <button v-if="!trash" class="text-button" @click="duplicateForm(form)" :disabled="busy">{{ t('manage.duplicate') }}</button>
                <a class="text-button" :href="`/api/admin/forms/${form.id}/definition`">{{ t('manage.definition') }}</a>
                <button v-if="!trash" class="text-button danger" @click="deleteForm(form)" :disabled="busy">{{ t('manage.delete') }}</button>
                <button v-if="trash" class="text-button" @click="restoreForm(form)" :disabled="busy">{{ t('manage.restore') }}</button>
                <button v-if="trash" class="text-button danger" @click="deleteForm(form, true)" :disabled="busy">{{ t('manage.purge') }}</button>
              </div></details>
            </div>
          </article>
        </div>
        <div v-if="filteredForms.length > formsPageSize" class="pagination forms-pagination">
          <button class="button" :disabled="formsPage <= 1 || busy" @click="formsPage--">
            {{ t('responses.previous') }}
          </button>
          <span>{{ formsPage }} / {{ formsTotalPages }}</span>
          <button class="button" :disabled="formsPage >= formsTotalPages || busy" @click="formsPage++">
            {{ t('responses.next') }}
          </button>
        </div>
      </div>

      <!-- FORM EDITOR VIEW -->
      <div v-else-if="view === 'editor'" class="editor-view">
        <div class="editor-toolbar">
          <button class="text-button" @click="back">{{ t('editor.back') }}</button>
          <div class="actions">
            <span class="muted small">{{ !draft.id ? t('editor.notCreated') : dirty ? t('editor.unsaved') : t('editor.saved') }}</span>
            <button class="button" @click="togglePreview">
              {{ preview ? t('editor.continue') : t('editor.preview') }}
            </button>
            <button class="button primary" :disabled="busy" @click="save">
              {{ busy ? t('editor.saving') : t('editor.save') }}
            </button>
          </div>
        </div>

        <nav v-if="!preview" class="editor-tabs segmented-control" :aria-label="t('editor.sections')"><button :class="{ active: editorTab === 'questions' }" @click="switchEditorTab('questions')">{{ t('editor.questionsTab') }}</button><button :class="{ active: editorTab === 'settings' }" @click="switchEditorTab('settings')">{{ t('editor.settingsTab') }}</button></nav>
        <div v-if="preview" class="preview-container">
          <Questionnaire :form="draft" preview />
        </div>

        <div v-else-if="editorTab === 'questions'" class="editor-layout">
          <section class="editor-content">
            <div class="panel">
              <div class="eyebrow">{{ t('editor.info') }}</div>
              <label class="stack-label">
                <span>{{ t('csv.title') }}</span>
                <input v-model="draft.title" maxlength="120" />
              </label>
              <label class="stack-label">
                <span>{{ t('labels.description') }}</span>
                <textarea
                  v-model="draft.description"
                  rows="3"
                  maxlength="3000"
                  :placeholder="t('editor.descriptionPlaceholder')"
                ></textarea>
              </label>
              <label class="stack-label">
                <span>{{ t('labels.thanks') }}</span>
                <textarea v-model="draft.thanks" rows="2" maxlength="1000"></textarea>
              </label>
            </div>

            <div v-if="!draft.fields.length" class="empty-fields">
              <span>＋</span>
              <h2>{{ t('editor.firstQuestion') }}</h2>
              <p>{{ t('editor.firstHint') }}</p>
            </div>

            <article v-for="(field, i) in draft.fields" :key="field.id" class="panel field-editor">
              <div class="field-toolbar">
                <span class="question-number">{{ String(i + 1).padStart(2, '0') }}</span>
                <select v-model="field.type" @change="changeType(field)" :aria-label="t('editor.type')">
                  <option v-for="(name, type) in fieldTypes" :key="type" :value="type">{{ t(name) }}</option>
                </select>
                <label class="required-toggle">
                  <input type="checkbox" v-model="field.required" />
                  {{ t('common.required') }}
                </label>
                <div class="actions compact">
                  <button class="icon-button" :disabled="i === 0" @click="move(i, -1)" :aria-label="t('editor.up')">↑</button>
                  <button class="icon-button" :disabled="i === draft.fields.length - 1" @click="move(i, 1)" :aria-label="t('editor.down')">↓</button>
                  <button class="icon-button" @click="duplicateField(i)" :aria-label="t('manage.copyQuestion')">⧉</button>
                  <button class="icon-button danger" @click="remove(i)" :aria-label="t('editor.remove')">×</button>
                </div>
              </div>

              <label class="stack-label">
                <span>{{ t('labels.question') }}</span>
                <input v-model="field.label" maxlength="200" />
              </label>

              <label class="stack-label">
                <span>{{ t('editor.help') }}</span>
                <span class="muted">{{ t('common.optional') }}</span>
                <textarea
                  v-model="field.description"
                  rows="2"
                  maxlength="1000"
                  :placeholder="t('editor.helpPlaceholder')"
                ></textarea>
              </label>

              <div v-if="choiceTypes.includes(field.type)" class="option-editor">
                <label class="stack-label"><span>{{ t('labels.option') }}</span></label>
                <div v-for="(_, j) in field.options" :key="j" class="option-row">
                  <span class="option-bullet"></span>
                  <input
                    v-model="field.options[j]"
                    :aria-label="t('editor.optionNumber', { number: j + 1 })"
                    maxlength="200"
                  />
                  <button
                    class="icon-button"
                    @click="field.options.splice(j, 1)"
                    :disabled="field.options.length <= 2"
                    :aria-label="t('editor.removeOption')"
                  >×</button>
                </div>
                <button
                  class="text-button"
                  :disabled="field.options.length >= 30"
                  @click="field.options.push(t('editor.optionNumber', { number: field.options.length + 1 }))"
                >{{ t('editor.addOption') }}</button>
              </div>

              <FieldSettings :field="field" :earlier="draft.fields.slice(0, i)" />
              <p v-if="field.type === 'file'" class="hint">{{ t('editor.fileHint') }}</p>
            </article>
          </section>

          <aside class="editor-sidebar">
            <div class="panel">
              <h3>{{ t('editor.add') }}</h3>
              <div class="type-grid">
                <button
                  v-for="(name, type) in fieldTypes"
                  :key="type"
                  class="type-button"
                  :disabled="draft.fields.length >= 30 || (type === 'file' && draft.fields.filter(f => f.type === 'file').length >= 2)"
                  @click="addField(type)"
                >
                  <span>{{ { short: t('editor.textIcon'), long: '☰', single: '◉', multi: '☑', select: '▾', file: '↥', email: '@', url: '↗', number: '#', date: '▦', rating: '☆' }[type] }}</span>
                  {{ t(name) }}
                </button>
              </div>
            </div>

          </aside>
        </div>
        <div v-else class="editor-settings-grid">            <div class="panel">
              <h3>{{ t('editor.publish') }}</h3>
              <label class="stack-label">
                <span>{{ t('editor.state') }}</span>
                <select v-model="draft.state">
                  <option value="draft">{{ t('editor.draft') }}</option>
                  <option value="published">{{ t('editor.published') }}</option>
                  <option value="closed">{{ t('editor.closed') }}</option>
                </select>
              </label>

              <label class="stack-label">
                <span>{{ t('labels.slug') }}</span>
                <input v-model="draft.slug" maxlength="64" pattern="[a-z0-9-]+" />
              </label>
              <p class="hint">{{ t('editor.slugHint') }}</p>

              <div class="share-url">{{ formUrl }}</div>
              <button
                class="button full-width"
                :disabled="!draft.id || dirty || draft.state !== 'published'"
                @click="copyLink(draft.slug)"
              >{{ t('editor.copy') }}</button>
              <p class="hint">{{ t('editor.saveHint') }}</p>
            </div>
            <SurveySettings :settings="draft.settings" />
</div>
      </div>

      <!-- RESPONSES VIEW -->
      <div v-else-if="view === 'responses'" class="responses-view">
        <button class="text-button" @click="back">{{ t('editor.back') }}</button>
        <div class="page-heading">
          <div>
            <div class="eyebrow">{{ t('responses.eyebrow') }}</div>
            <h1>{{ responseForm.title }}</h1>
            <p class="muted">
              {{ filter ? t('responses.filtered', { count: total, status: t(statusKeys[filter]) }) : t('responses.total', { count: total }) }}
            </p>
          </div>
          <div class="actions">
            <select
              v-model="filter"
              :aria-label="t('responses.filter')"
              @change="page = 1; selected = null; run(loadResponses)"
            >
              <option value="">{{ t('responses.all') }}</option>
              <option v-for="status in statuses" :key="status" :value="status">{{ t(statusKeys[status]) }}</option>
            </select>
            <a class="button" :href="`/api/admin/forms/${responseForm.id}/export?lang=${locale}`">
              {{ t('responses.export') }}
            </a>
          </div>
        </div>

        <details class="insights-disclosure"><summary>{{ t('manage.statistics') }}</summary><AdminInsights :stats="statistics" /></details>
        <div class="management-toolbar">
          <input type="search" v-model="responseSearch" :placeholder="t('manage.responseSearch')" :aria-label="t('manage.responseSearch')" @keyup.enter="searchResponses" />
          <button class="button" @click="searchResponses" :disabled="busy">{{ t('manage.searchAction') }}</button>
          <label class="check-row"><input type="checkbox" v-model="responseTrash" @change="searchResponses" />{{ t('manage.responseTrash') }}</label>
        </div>
        <div class="batch-toolbar">
          <label class="check-row"><input type="checkbox" :checked="responses.length > 0 && checked.length === responses.length" @change="selectAll" />{{ t('manage.selectAll') }}</label>
          <span>{{ t('manage.selected', { count: checked.length }) }}</span>
          <template v-if="!responseTrash"><select v-model="batchStatus" :aria-label="t('manage.batchStatus')"><option v-for="status in statuses" :key="status" :value="status">{{ t(statusKeys[status]) }}</option></select><button class="button" :disabled="busy || !checked.length" @click="batchResponses('status')">{{ t('manage.batchStatus') }}</button><button class="button danger" :disabled="busy || !checked.length" @click="batchResponses('trash')">{{ t('manage.delete') }}</button></template>
          <template v-else><button class="button" :disabled="busy || !checked.length" @click="batchResponses('restore')">{{ t('manage.restoreResponses') }}</button><button class="button danger" :disabled="busy || !checked.length" @click="batchResponses('purge')">{{ t('manage.purge') }}</button></template>
        </div>
        <div class="responses-layout">
          <section>
            <div v-if="!responses.length" class="panel muted">
              {{ busy ? t('common.loading') : t('responses.empty') }}
            </div>

            <div v-for="item in responses" :key="item.id" class="response-item">
            <input type="checkbox" v-model="checked" :value="item.id" :aria-label="t('responses.id', { id: item.id.slice(0, 8) })" />
            <button
              class="response-row"
              :class="{ active: selected?.id === item.id }"
              @click="selected = clone(item)"
            >
              <div class="card-top">
                <span class="badge">{{ t(statusKeys[item.status]) }}</span>
                <span class="small muted">{{ formatDate(item.createdAt) }}</span>
              </div>
              <p>{{ summary(item) }}</p>
              <div class="small muted">
                #{{ item.id.slice(0, 8).toUpperCase() }}
                <span v-if="item.attachments.length">{{ t('responses.attachments', { count: item.attachments.length }) }}</span>
              </div>
            </button>

            </div>
            <div class="pagination">
              <button class="button" :disabled="page <= 1 || busy" @click="changePage(-1)">
                {{ t('responses.previous') }}
              </button>
              <span>{{ page }} / {{ Math.max(1, Math.ceil(total / 30)) }}</span>
              <button class="button" :disabled="page * 30 >= total || busy" @click="changePage(1)">
                {{ t('responses.next') }}
              </button>
            </div>
          </section>

          <section class="panel response-detail" v-if="selected">
            <div class="eyebrow">{{ t('responses.id', { id: selected.id.slice(0, 8).toUpperCase() }) }}</div>
            <h2>{{ selected.snapshot.title }}</h2>
            <p class="small muted">
              {{ t('responses.version', { date: formatDate(selected.createdAt), version: selected.snapshot.version }) }}
            </p>

            <dl>
              <template v-for="field in selected.snapshot.fields" :key="field.id">
                <dt>{{ field.label }}</dt>
                <dd v-if="field.type !== 'file'" class="preserve">{{ answer(selected, field) }}</dd>
                <dd v-else>
                  <a
                    v-for="attachment in selected.attachments.filter(a => a.fieldId === field.id)"
                    :key="attachment.id"
                    class="attachment-link"
                    :href="`/api/admin/responses/${selected.id}/files/${attachment.id}`"
                  >
                    ↓ {{ attachment.name }}
                    <small>{{ t('common.fileSize', { size: (attachment.size / 1024).toFixed(1) }) }}</small>
                  </a>
                  <span v-if="!selected.attachments.some(a => a.fieldId === field.id)" class="muted">
                    {{ t('responses.notUploaded') }}
                  </span>
                </dd>
              </template>
            </dl>

            <div v-if="!responseTrash" class="review-controls">
              <label class="stack-label">
                <span>{{ t('csv.status') }}</span>
                <select v-model="selected.status">
                  <option v-for="status in statuses" :key="status" :value="status">{{ t(statusKeys[status]) }}</option>
                </select>
              </label>

              <label class="stack-label">
                <span>{{ t('csv.note') }}</span>
                <textarea
                  v-model="selected.note"
                  rows="3"
                  maxlength="10000"
                  :placeholder="t('responses.notePlaceholder')"
                ></textarea>
              </label>

              <button class="button primary" :disabled="busy" @click="saveResponse">
                {{ t('responses.save') }}
              </button>
            </div>
          </section>

          <section v-else class="panel detail-placeholder">
            {{ t('responses.select') }}
          </section>
        </div>
      </div>
      <div v-else-if="view === 'system'" class="system-view"><button class="text-button" @click="back">{{ t('editor.back') }}</button><SystemPanel :data="system" :sessions="sessions" :request="api" @password-changed="passwordChanged" @refresh="run(refreshSystem)" /></div>
    </main>

    <!-- Custom In-Page Confirmation & Prompt Modal -->
    <Teleport to="body">
      <div v-if="modal.open" class="modal-backdrop" @click.self="confirmModalCancel">
        <div class="modal-dialog" role="dialog" aria-modal="true" @keydown.esc="confirmModalCancel">
          <div class="modal-header">
            <span class="modal-icon-badge" :class="{ danger: modal.danger }">!</span>
            <h2>{{ modal.title }}</h2>
          </div>
          <div class="modal-body">
            <p>{{ modal.message }}</p>
            <div v-if="modal.prompt" class="modal-prompt-wrap">
              <input
                v-model="modal.promptValue"
                :placeholder="t('manage.confirmInputPlaceholder')"
                autofocus
                @keydown.enter.prevent="confirmModalSubmit"
              />
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="button" @click="confirmModalCancel">
              {{ t('common.cancel') }}
            </button>
            <button
              type="button"
              class="button"
              :class="{ danger: modal.danger, primary: !modal.danger }"
              :disabled="modal.prompt && modal.expected && modal.promptValue !== modal.expected"
              @click="confirmModalSubmit"
            >
              {{ modal.confirmText || t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
