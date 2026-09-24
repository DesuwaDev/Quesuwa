<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { api, allowed } from '../lib/api.js';
import { route, updateQuery, linkHandler, navigate } from '../lib/router.js';
import { storage } from '../lib/storage.js';
import { relativeTime, formatNumber } from '../lib/format.js';
import { copyText } from '../lib/clipboard.js';
import { confirmDialog, promptDialog, notify, notifyError } from '../lib/feedback.js';
import { stateKeys } from '../../shared/constants.js';
import { answerable } from '../../shared/schema.js';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import MenuButton from '../components/MenuButton.vue';
import PaginationBar from '../components/PaginationBar.vue';
import NewFormDialog from './NewFormDialog.vue';

const forms = ref([]), loading = ref(true), busy = ref(false), creating = ref(false);
const trash = computed(() => route.query.trash === '1');
const search = ref(route.query.q || ''), stateFilter = ref(route.query.state || ''), sort = ref(storage.get('quesuwa.formSort') || 'updated');
const layout = ref(storage.get('quesuwa.formLayout') === 'list' ? 'list' : 'grid');
const page = ref(1);
const pageSize = computed(() => layout.value === 'list' ? 20 : 12);

const counts = computed(() => Object.fromEntries(['draft', 'published', 'closed'].map(state => [state, forms.value.filter(form => form.state === state).length])));
const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  const list = forms.value.filter(form => (!stateFilter.value || trash.value || form.state === stateFilter.value) && (!term || (form.title + ' ' + form.slug + ' ' + (form.description || '')).toLocaleLowerCase().includes(term)));
  const by = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    responses: (a, b) => b.responseCount - a.responseCount,
    title: (a, b) => a.title.localeCompare(b.title),
    activity: (a, b) => (b.lastResponseAt || '').localeCompare(a.lastResponseAt || '')
  }[sort.value] || (() => 0);
  return [...list].sort(by);
});
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

watch([search, stateFilter], () => { page.value = 1; updateQuery({ q: search.value.trim(), state: stateFilter.value }); });
watch(sort, value => { storage.set('quesuwa.formSort', value); page.value = 1; });
watch(layout, value => { storage.set('quesuwa.formLayout', value); page.value = 1; });
watch(trash, load);

async function load() {
  loading.value = true;
  try { forms.value = await api('/admin/forms' + (trash.value ? '?trash=true' : '')); }
  catch (error) { notifyError(error); }
  finally { loading.value = false; }
}
onMounted(load);

const publicUrl = form => window.location.origin + '/f/' + form.slug;
const questionCount = form => form.fields.filter(answerable).length;

async function act(task, messageKey = 'common.done') {
  busy.value = true;
  try { await task(); if (messageKey) notify(messageKey); await load(); }
  catch (error) { notifyError(error); }
  finally { busy.value = false; }
}

async function copyLink(form) {
  if (await copyText(publicUrl(form))) notify('share.copied');
}
const setState = (form, state) => act(() => api('/admin/forms/' + form.id + '/state', { method: 'POST', body: { state } }), state === 'published' ? 'forms.publishedNow' : 'forms.closedNow');
const duplicate = form => act(async () => {
  const copy = await api('/admin/forms/' + form.id + '/duplicate', { method: 'POST', body: {} });
  navigate('/admin/forms/' + copy.id + '/edit');
}, 'forms.duplicated');
async function remove(form) {
  if (!(await confirmDialog({ titleKey: 'forms.trashTitle', messageKey: 'forms.trashConfirm', params: { title: form.title }, danger: true, confirmKey: 'forms.trash' }))) return;
  act(() => api('/admin/forms/' + form.id, { method: 'DELETE', body: {} }), 'forms.trashed');
}
const restore = form => act(() => api('/admin/forms/' + form.id + '/restore', { method: 'POST', body: {} }), 'forms.restored');
async function purge(form) {
  const confirmation = await promptDialog({ titleKey: 'forms.purgeTitle', messageKey: 'forms.purgeConfirm', params: { title: form.title, count: form.responseCount }, expected: form.title, danger: true, confirmKey: 'forms.purge' });
  if (confirmation !== form.title) return;
  act(() => api('/admin/forms/' + form.id + '?permanent=true', { method: 'DELETE', body: { confirmation } }), 'forms.purged');
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ trash ? t('forms.trashEyebrow') : t('nav.forms') }}</span>
        <h1>{{ trash ? t('forms.trashHeading') : t('forms.heading') }}</h1>
        <p class="muted">{{ trash ? t('forms.trashIntro') : t('forms.intro') }}</p>
      </div>
      <div class="page-actions">
        <a v-if="!trash" class="button ghost" href="/admin/forms?trash=1" @click="linkHandler('/admin/forms?trash=1')($event)"><AppIcon name="trash" :size="16" /><span class="hide-narrow">{{ t('forms.trashLink') }}</span></a>
        <a v-else class="button" href="/admin/forms" @click="linkHandler('/admin/forms')($event)"><AppIcon name="arrowLeft" :size="16" />{{ t('forms.backToForms') }}</a>
        <button v-if="!trash && allowed('forms.write')" type="button" class="button primary" @click="creating = true"><AppIcon name="plus" :size="16" />{{ t('forms.new') }}</button>
      </div>
    </header>

    <div class="toolbar">
      <label class="search-input grow">
        <AppIcon name="search" :size="16" />
        <input v-model="search" type="search" :placeholder="t('forms.search')" :aria-label="t('forms.search')" />
      </label>
      <div v-if="!trash" class="chip-group" role="group" :aria-label="t('forms.filterState')">
        <button type="button" class="chip" :class="{ active: !stateFilter }" @click="stateFilter = ''">{{ t('forms.allStates') }}<span>{{ forms.length }}</span></button>
        <button v-for="(key, state) in stateKeys" :key="state" type="button" class="chip" :class="{ active: stateFilter === state }" @click="stateFilter = state">{{ t(key) }}<span>{{ counts[state] }}</span></button>
      </div>
      <select v-model="sort" class="input select compact" :aria-label="t('forms.sort')">
        <option value="updated">{{ t('forms.sortUpdated') }}</option>
        <option value="created">{{ t('forms.sortCreated') }}</option>
        <option value="activity">{{ t('forms.sortActivity') }}</option>
        <option value="responses">{{ t('forms.sortResponses') }}</option>
        <option value="title">{{ t('forms.sortTitle') }}</option>
      </select>
      <div class="segmented" role="group" :aria-label="t('forms.layout')">
        <button type="button" :class="{ active: layout === 'grid' }" :aria-pressed="layout === 'grid'" :title="t('forms.layoutGrid')" :aria-label="t('forms.layoutGrid')" @click="layout = 'grid'"><AppIcon name="dashboard" :size="16" /></button>
        <button type="button" :class="{ active: layout === 'list' }" :aria-pressed="layout === 'list'" :title="t('forms.layoutList')" :aria-label="t('forms.layoutList')" @click="layout = 'list'"><AppIcon name="menu" :size="16" /></button>
      </div>
    </div>

    <div v-if="loading && !forms.length" class="card-grid"><div v-for="index in 6" :key="index" class="skeleton-card"></div></div>
    <EmptyState v-else-if="!forms.length && trash" icon="trash" :title="t('forms.trashEmpty')" />
    <EmptyState v-else-if="!forms.length" icon="forms" :title="t('forms.empty')" :text="t('forms.emptyHint')">
      <button v-if="allowed('forms.write')" type="button" class="button primary" @click="creating = true"><AppIcon name="plus" :size="16" />{{ t('forms.new') }}</button>
    </EmptyState>
    <EmptyState v-else-if="!filtered.length" icon="search" :title="t('forms.noMatches')" compact />

    <div v-else :class="layout === 'grid' ? 'card-grid' : 'form-rows'" :aria-busy="busy">
      <article v-for="form in visible" :key="form.id" class="form-card" :class="['accent-' + (form.settings?.accent || 'coral'), { row: layout === 'list' }]">
        <span class="form-card-strip"></span>
        <div class="form-card-top">
          <StatusBadge :state="form.state" :trashed="Boolean(form.deletedAt)" />
          <span v-if="form.settings?.accessCode" class="badge muted" :title="t('settings.accessCode')"><AppIcon name="lock" :size="12" /></span>
          <MenuButton :label="t('common.more')" class="form-card-menu">
            <template v-if="!trash">
              <button v-if="form.state === 'published'" type="button" class="menu-item" @click="copyLink(form)"><AppIcon name="link" :size="16" />{{ t('share.copyLink') }}</button>
              <a v-if="form.state === 'published'" class="menu-item" :href="'/f/' + form.slug" target="_blank" rel="noopener"><AppIcon name="external" :size="16" />{{ t('share.open') }}</a>
              <template v-if="allowed('forms.write')">
                <button v-if="form.state !== 'published'" type="button" class="menu-item" @click="setState(form, 'published')"><AppIcon name="play" :size="16" />{{ t('forms.publish') }}</button>
                <button v-else type="button" class="menu-item" @click="setState(form, 'closed')"><AppIcon name="archive" :size="16" />{{ t('forms.close') }}</button>
                <button type="button" class="menu-item" @click="duplicate(form)"><AppIcon name="copy" :size="16" />{{ t('forms.duplicate') }}</button>
              </template>
              <a class="menu-item" :href="'/api/admin/forms/' + form.id + '/definition'" download><AppIcon name="download" :size="16" />{{ t('forms.exportDefinition') }}</a>
              <button v-if="allowed('forms.write')" type="button" class="menu-item danger" @click="remove(form)"><AppIcon name="trash" :size="16" />{{ t('forms.trash') }}</button>
            </template>
            <template v-else>
              <button v-if="allowed('forms.write')" type="button" class="menu-item" @click="restore(form)"><AppIcon name="restore" :size="16" />{{ t('forms.restore') }}</button>
              <button v-if="allowed('forms.purge')" type="button" class="menu-item danger" @click="purge(form)"><AppIcon name="trash" :size="16" />{{ t('forms.purge') }}</button>
              <a class="menu-item" :href="'/api/admin/forms/' + form.id + '/definition'" download><AppIcon name="download" :size="16" />{{ t('forms.exportDefinition') }}</a>
            </template>
          </MenuButton>
        </div>
        <a class="form-card-title" :href="'/admin/forms/' + form.id + (trash ? '/responses' : '/edit')" @click="linkHandler('/admin/forms/' + form.id + (trash ? '/responses' : '/edit'))($event)">
          <h2>{{ form.title }}</h2>
        </a>
        <p class="form-card-desc clamp-2">{{ form.description || t('forms.noDescription') }}</p>
        <div class="form-card-stats">
          <span><strong>{{ formatNumber(form.responseCount) }}</strong>{{ t('forms.responsesUnit') }}</span>
          <span>{{ t('common.questions', { count: questionCount(form) }) }}</span>
          <span v-if="form.lastResponseAt" class="muted">{{ t('forms.lastResponse', { time: relativeTime(form.lastResponseAt) }) }}</span>
        </div>
        <div class="form-card-foot">
          <span class="muted small">{{ trash ? t('forms.deletedAt', { time: relativeTime(form.deletedAt) }) : t('forms.updatedBy', { time: relativeTime(form.updatedAt), user: form.updatedBy || '—' }) }}</span>
          <div class="form-card-actions">
            <a v-if="!trash" class="button small" :href="'/admin/forms/' + form.id + '/edit'" @click="linkHandler('/admin/forms/' + form.id + '/edit')($event)"><AppIcon :name="allowed('forms.write') ? 'edit' : 'eye'" :size="15" />{{ allowed('forms.write') ? t('forms.edit') : t('forms.view') }}</a>
            <a class="button small" :href="'/admin/forms/' + form.id + '/responses'" @click="linkHandler('/admin/forms/' + form.id + '/responses')($event)"><AppIcon name="inbox" :size="15" />{{ t('forms.responses') }}</a>
          </div>
        </div>
      </article>
    </div>
    <PaginationBar :page="page" :total="filtered.length" :page-size="pageSize" @change="page = $event" />
    <NewFormDialog v-if="creating" @close="creating = false" />
  </div>
</template>
