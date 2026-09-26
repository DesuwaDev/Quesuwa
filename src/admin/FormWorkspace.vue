<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue';
import { t } from '../i18n.js';
import { api, allowed } from '../lib/api.js';
import { addLeaveGuard, navigate, linkHandler } from '../lib/router.js';
import { confirmDialog, notify, notifyError } from '../lib/feedback.js';
import { copyText } from '../lib/clipboard.js';
import { formatNumber, relativeTime } from '../lib/format.js';
import { defaultSettings, editableField } from '../../shared/schema.js';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import MenuButton from '../components/MenuButton.vue';
import EmptyState from '../components/EmptyState.vue';
import QuestionEditor from './editor/QuestionEditor.vue';
import FormSettings from './editor/FormSettings.vue';
import SharePanel from './editor/SharePanel.vue';
import PreviewDialog from './editor/PreviewDialog.vue';
import ResponsesView from './responses/ResponsesView.vue';
import AnalyticsView from './analytics/AnalyticsView.vue';
import { repairLogic, serializeFields } from './editor/fields.js';

const props = defineProps({ formId: { type: String, required: true }, tab: { type: String, default: 'edit' } });
const form = ref(null), draft = ref(null), original = ref(''), loading = ref(true), loadError = ref(null), saving = ref(false), previewing = ref(false);
const editor = ref(null);
const editTabs = ['edit', 'settings', 'share'];
const readonly = computed(() => !allowed('forms.write') || Boolean(form.value?.deletedAt));
const dirty = computed(() => Boolean(draft.value) && JSON.stringify(draft.value) !== original.value);
const base = computed(() => '/admin/forms/' + props.formId);
const tabs = computed(() => [
  { key: 'edit', icon: 'edit', label: 'workspace.edit' },
  { key: 'settings', icon: 'sliders', label: 'workspace.settings' },
  { key: 'share', icon: 'share', label: 'workspace.share' },
  { key: 'responses', icon: 'inbox', label: 'workspace.responses', count: form.value?.responseCount },
  { key: 'analytics', icon: 'chart', label: 'workspace.analytics' }
]);

function adopt(value) {
  form.value = value;
  const copy = structuredClone(value);
  draft.value = {
    title: copy.title,
    description: copy.description || '',
    thanks: copy.thanks || '',
    slug: copy.slug,
    state: copy.state,
    settings: { ...defaultSettings, ...copy.settings },
    fields: copy.fields.map(editableField)
  };
  original.value = JSON.stringify(draft.value);
  document.title = value.title + ' · ' + t('app.brand');
}

async function load() {
  loading.value = true;
  try { adopt(await api('/admin/forms/' + props.formId)); }
  catch (error) { loadError.value = error; }
  finally { loading.value = false; }
}

async function save() {
  if (readonly.value || saving.value || !dirty.value) return;
  saving.value = true;
  const removed = repairLogic(draft.value.fields);
  try {
    const saved = await api('/admin/forms/' + props.formId, { method: 'PUT', body: { ...draft.value, fields: serializeFields(draft.value.fields), version: form.value.version } });
    adopt(saved);
    notify(removed ? 'workspace.savedRepaired' : saved.state === 'published' ? 'workspace.savedLive' : 'workspace.saved', { params: { count: removed } });
  } catch (error) {
    if (error.code === 'errors.editConflict') {
      if (await confirmDialog({ titleKey: 'workspace.conflictTitle', messageKey: 'workspace.conflict', confirmKey: 'workspace.reload', danger: true })) await load();
    } else {
      notifyError(error);
      if (Number.isInteger(error.params?.index)) {
        if (props.tab !== 'edit') await navigate(base.value + '/edit');
        editor.value?.focusIndex(error.params.index - 1);
      }
    }
  } finally { saving.value = false; }
}

function discard() {
  draft.value = JSON.parse(original.value);
}

const guard = async target => {
  if (!dirty.value) return true;
  if (target.startsWith(base.value) && editTabs.includes(target.split('/').pop())) return true;
  const ok = await confirmDialog({ titleKey: 'workspace.leaveTitle', messageKey: 'workspace.leave', confirmKey: 'workspace.discard', danger: true });
  if (ok) discard();
  return ok;
};
guard.dirty = () => dirty.value;
const removeGuard = addLeaveGuard(guard);

function shortcut(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
}
onMounted(() => { load(); window.addEventListener('keydown', shortcut); });
onBeforeUnmount(() => { removeGuard(); window.removeEventListener('keydown', shortcut); });

async function copyLink() {
  if (await copyText(window.location.origin + '/f/' + form.value.slug)) notify('share.copied');
}
async function duplicate() {
  try {
    const copy = await api('/admin/forms/' + props.formId + '/duplicate', { method: 'POST', body: {} });
    notify('forms.duplicated');
    navigate('/admin/forms/' + copy.id + '/edit');
  } catch (error) { notifyError(error); }
}
async function trash() {
  // Never-saved questionnaires without responses go straight to the trash.
  const untouched = form.value.version === 1 && !form.value.responseCount && !dirty.value;
  if (!untouched && !(await confirmDialog({ titleKey: 'forms.trashTitle', messageKey: 'forms.trashConfirm', params: { title: form.value.title }, danger: true, confirmKey: 'forms.trash' }))) return;
  if (dirty.value) discard();
  try {
    await api('/admin/forms/' + props.formId, { method: 'DELETE', body: {} });
    notify('forms.trashed');
    navigate('/admin/forms', { force: true });
  } catch (error) { notifyError(error); }
}
function refreshCount(count) { if (form.value) form.value.responseCount = count; }

provide('workspace', { reload: load });
</script>

<template>
  <div class="page workspace">
    <div v-if="loading && !form" class="boot-screen inline"><span class="spinner"></span></div>
    <EmptyState v-else-if="loadError" icon="alert" :title="t(loadError.code || 'errors.operation', loadError.params || {})">
      <a class="button" href="/admin/forms" @click="linkHandler('/admin/forms')($event)">{{ t('forms.backToForms') }}</a>
    </EmptyState>
    <template v-else-if="form">
      <header class="workspace-header">
        <a class="back-link" href="/admin/forms" @click="linkHandler('/admin/forms')($event)"><AppIcon name="arrowLeft" :size="16" />{{ t('nav.forms') }}</a>
        <div class="workspace-title">
          <h1 class="clamp-1" :title="draft.title">{{ draft.title || t('common.untitled') }}</h1>
          <StatusBadge :state="form.state" :trashed="Boolean(form.deletedAt)" />
          <span v-if="editTabs.includes(tab) && !readonly" class="save-state" :class="{ dirty }">{{ saving ? t('editor.saving') : dirty ? t('editor.unsaved') : t('workspace.savedAgo', { time: relativeTime(form.updatedAt) }) }}</span>
        </div>
        <div class="workspace-actions">
          <button type="button" class="button ghost" @click="previewing = true"><AppIcon name="eye" :size="16" /><span class="hide-narrow">{{ t('editor.preview') }}</span></button>
          <button v-if="form.state === 'published' && !form.deletedAt" type="button" class="button ghost hide-narrow" @click="copyLink"><AppIcon name="link" :size="16" />{{ t('share.copyLink') }}</button>
          <button v-if="!readonly && editTabs.includes(tab)" type="button" class="button primary" :disabled="saving || !dirty" :title="t('workspace.saveShortcut')" @click="save"><AppIcon name="check" :size="16" />{{ saving ? t('editor.saving') : t('editor.save') }}</button>
          <MenuButton :label="t('common.more')">
            <button v-if="dirty && !readonly" type="button" class="menu-item" @click="discard"><AppIcon name="restore" :size="16" />{{ t('workspace.discardChanges') }}</button>
            <a v-if="form.state === 'published'" class="menu-item" :href="'/f/' + form.slug" target="_blank" rel="noopener"><AppIcon name="external" :size="16" />{{ t('share.open') }}</a>
            <button v-if="allowed('forms.write') && !form.deletedAt" type="button" class="menu-item" @click="duplicate"><AppIcon name="copy" :size="16" />{{ t('forms.duplicate') }}</button>
            <a class="menu-item" :href="'/api/admin/forms/' + form.id + '/definition'" download><AppIcon name="download" :size="16" />{{ t('forms.exportDefinition') }}</a>
            <button v-if="allowed('forms.write') && !form.deletedAt" type="button" class="menu-item danger" @click="trash"><AppIcon name="trash" :size="16" />{{ t('forms.trash') }}</button>
          </MenuButton>
        </div>
      </header>
      <nav class="tabs" :aria-label="t('workspace.sections')">
        <a v-for="item in tabs" :key="item.key" class="tab" :class="{ active: tab === item.key }" :href="base + '/' + item.key" :aria-current="tab === item.key ? 'page' : undefined" @click="linkHandler(base + '/' + item.key)($event)">
          <AppIcon :name="item.icon" :size="16" /><span>{{ t(item.label) }}</span><span v-if="item.count !== undefined" class="tab-count">{{ formatNumber(item.count) }}</span>
        </a>
      </nav>
      <div v-if="form.deletedAt" class="banner warning"><AppIcon name="trash" :size="16" />{{ t('workspace.inTrash') }}</div>
      <div v-else-if="readonly && editTabs.includes(tab)" class="banner"><AppIcon name="lock" :size="16" />{{ t('workspace.readonly') }}</div>

      <QuestionEditor v-if="tab === 'edit'" ref="editor" :draft="draft" :readonly="readonly" />
      <FormSettings v-else-if="tab === 'settings'" :draft="draft" :form="form" :readonly="readonly" />
      <SharePanel v-else-if="tab === 'share'" :form="form" :dirty="dirty" />
      <ResponsesView v-else-if="tab === 'responses'" :form="form" @count="refreshCount" />
      <AnalyticsView v-else-if="tab === 'analytics'" :form="form" />

      <div v-if="dirty && !readonly && editTabs.includes(tab)" class="save-dock">
        <span>{{ t('editor.unsaved') }}</span>
        <button type="button" class="button ghost small" @click="discard">{{ t('workspace.discardChanges') }}</button>
        <button type="button" class="button primary small" :disabled="saving" @click="save">{{ saving ? t('editor.saving') : t('editor.save') }}</button>
      </div>
      <PreviewDialog v-if="previewing" :form="{ ...form, ...draft, fields: serializeFields(draft.fields), version: form.version }" @close="previewing = false" />
    </template>
  </div>
</template>
