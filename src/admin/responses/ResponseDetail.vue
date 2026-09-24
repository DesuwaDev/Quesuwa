<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../../i18n.js';
import { api, allowed } from '../../lib/api.js';
import { notify, notifyError, confirmDialog } from '../../lib/feedback.js';
import { copyText } from '../../lib/clipboard.js';
import { formatDate, formatDuration, formatBytes, shortId } from '../../lib/format.js';
import { statuses } from '../../../shared/constants.js';
import { answerable } from '../../../shared/schema.js';
import { isAnswered, isOtherValue } from '../../../shared/answers.js';
import AppIcon from '../../components/AppIcon.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { answerText } from './format.js';

const props = defineProps({ responseId: String, form: Object, hasPrevious: Boolean, hasNext: Boolean, writable: Boolean });
const emit = defineEmits(['close', 'previous', 'next', 'updated', 'removed']);
const response = ref(null), error = ref(null), note = ref(''), savingNote = ref(false);
const fields = computed(() => response.value?.snapshot.fields.filter(answerable) || []);
const noteDirty = computed(() => response.value && note.value.trim() !== response.value.note);
const files = fieldId => response.value.attachments.filter(file => file.fieldId === fieldId);
const fileUrl = file => '/api/admin/responses/' + response.value.id + '/files/' + file.id;
const isImage = file => /^image\/(png|jpeg|webp|gif)$/.test(file.mime);
const safeUrl = value => /^https?:\/\//i.test(value) ? value : '';
const languageKey = code => ({ 'zh-CN': 'language.zhCN', en: 'language.en' })[code];

async function load() {
  try {
    response.value = await api('/admin/responses/' + props.responseId);
    note.value = response.value.note;
  } catch (reason) { error.value = reason; }
}

async function patch(body, messageKey) {
  try {
    const updated = await api('/admin/responses/' + response.value.id, { method: 'PATCH', body });
    Object.assign(response.value, updated);
    note.value = updated.note;
    emit('updated', updated);
    if (messageKey) notify(messageKey);
  } catch (reason) { notifyError(reason); }
}
const setStatus = status => { if (status !== response.value.status) patch({ status }, 'responses.statusSaved'); };
const toggleStar = () => patch({ starred: !response.value.starred });
async function saveNote() {
  savingNote.value = true;
  await patch({ note: note.value }, 'responses.noteSaved');
  savingNote.value = false;
}

async function trash() {
  if (!(await confirmDialog({ titleKey: 'responses.trashTitle', messageKey: 'responses.trashConfirm', params: { count: 1 }, danger: true, confirmKey: 'responses.trash' }))) return;
  try {
    await api('/admin/forms/' + props.form.id + '/responses/batch', { method: 'POST', body: { ids: [response.value.id], action: 'trash' } });
    notify('responses.batchDone', { params: { count: 1 } });
    emit('removed');
  } catch (reason) { notifyError(reason); }
}
async function restore() {
  try {
    await api('/admin/forms/' + props.form.id + '/responses/batch', { method: 'POST', body: { ids: [response.value.id], action: 'restore' } });
    notify('responses.batchDone', { params: { count: 1 } });
    emit('removed');
  } catch (reason) { notifyError(reason); }
}
async function copyLink() {
  if (await copyText(window.location.origin + '/admin/forms/' + props.form.id + '/responses?r=' + response.value.id)) notify('share.copied');
}

const printPage = () => window.print();

function keys(event) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (event.key === 'Escape') emit('close');
  else if ((event.key === 'ArrowLeft' || event.key === 'k') && props.hasPrevious) emit('previous');
  else if ((event.key === 'ArrowRight' || event.key === 'j') && props.hasNext) emit('next');
}
onMounted(() => { load(); window.addEventListener('keydown', keys); });
onBeforeUnmount(() => window.removeEventListener('keydown', keys));
</script>

<template>
  <section class="response-detail card" :aria-label="t('responses.detail')">
    <header class="detail-head">
      <button type="button" class="icon-button ghost show-mobile" :aria-label="t('common.back')" @click="emit('close')"><AppIcon name="arrowLeft" /></button>
      <div class="detail-title">
        <span class="eyebrow">{{ t('responses.detail') }}</span>
        <h2 class="mono">#{{ shortId(responseId) }}</h2>
      </div>
      <span class="spacer"></span>
      <button type="button" class="icon-button ghost" :disabled="!hasPrevious" :title="t('responses.previous')" :aria-label="t('responses.previous')" @click="emit('previous')"><AppIcon name="chevronLeft" /></button>
      <button type="button" class="icon-button ghost" :disabled="!hasNext" :title="t('responses.next')" :aria-label="t('responses.next')" @click="emit('next')"><AppIcon name="chevronRight" /></button>
      <button type="button" class="icon-button ghost hide-mobile" :aria-label="t('common.close')" @click="emit('close')"><AppIcon name="close" /></button>
    </header>

    <p v-if="error" class="form-error"><AppIcon name="alert" :size="16" />{{ t(error.code || 'errors.operation', error.params || {}) }}</p>
    <div v-else-if="!response" class="detail-loading"><span class="spinner"></span></div>
    <template v-else>
      <div class="detail-meta">
        <span><AppIcon name="clock" :size="14" />{{ formatDate(response.createdAt) }}</span>
        <span v-if="response.durationMs"><AppIcon name="activity" :size="14" />{{ t('responses.duration', { time: formatDuration(response.durationMs) }) }}</span>
        <span v-if="languageKey(response.locale)"><AppIcon name="globe" :size="14" />{{ t(languageKey(response.locale)) }}</span>
        <span><AppIcon name="layers" :size="14" />{{ t('responses.version', { version: response.snapshot.version }) }}</span>
        <span v-if="response.deletedAt" class="badge muted">{{ t('responses.inTrash') }}</span>
      </div>

      <div class="review-panel">
        <div class="review-row">
          <span class="field-label">{{ t('responses.status') }}</span>
          <div class="status-picker" role="radiogroup" :aria-label="t('responses.status')">
            <button v-for="status in statuses" :key="status" type="button" role="radio" :aria-checked="response.status === status" :class="{ active: response.status === status }" :disabled="!writable" @click="setStatus(status)"><StatusBadge :status="status" /></button>
          </div>
        </div>
        <label class="field">
          <span class="field-label">{{ t('responses.note') }}</span>
          <textarea v-model="note" class="input textarea autosize" rows="2" maxlength="10000" :disabled="!writable" :placeholder="t('responses.notePlaceholder')"></textarea>
        </label>
        <div class="review-actions">
          <button type="button" class="star-button labeled" :class="{ on: response.starred }" :disabled="!writable" :aria-pressed="response.starred" @click="toggleStar"><AppIcon name="star" :size="16" :filled="response.starred" />{{ response.starred ? t('responses.starredOn') : t('responses.star') }}</button>
          <span class="spacer"></span>
          <button v-if="writable" type="button" class="button primary small" :disabled="!noteDirty || savingNote" @click="saveNote">{{ t('responses.saveNote') }}</button>
        </div>
      </div>

      <dl class="answer-list">
        <div v-for="(field, position) in fields" :key="field.id" class="answer-item">
          <dt><span class="answer-number">{{ position + 1 }}</span>{{ field.label }}</dt>
          <dd v-if="field.type === 'file'">
            <ul v-if="files(field.id).length" class="attachment-list">
              <li v-for="file in files(field.id)" :key="file.id">
                <a v-if="isImage(file)" class="attachment-thumb" :href="fileUrl(file) + '?inline=1'" target="_blank" rel="noopener"><img :src="fileUrl(file) + '?inline=1'" :alt="file.name" loading="lazy" /></a>
                <span v-else class="file-icon"><AppIcon name="file" :size="18" /></span>
                <span class="file-name">{{ file.name }}<small>{{ formatBytes(file.size) }}</small></span>
                <a class="icon-button ghost small" :href="fileUrl(file)" :aria-label="t('responses.download', { name: file.name })" download><AppIcon name="download" :size="16" /></a>
              </li>
            </ul>
            <span v-else class="muted">{{ t('responses.unanswered') }}</span>
          </dd>
          <dd v-else-if="!isAnswered(field, response.answers[field.id])" class="muted">{{ t('responses.unanswered') }}</dd>
          <dd v-else-if="field.type === 'matrix'">
            <table class="mini-table"><tbody><tr v-for="(row, rowIndex) in field.rows" :key="row"><th scope="row">{{ row }}</th><td>{{ response.answers[field.id][rowIndex] || '—' }}</td></tr></tbody></table>
          </dd>
          <dd v-else-if="field.type === 'ranking'"><ol class="ranked-answer"><li v-for="item in response.answers[field.id]" :key="item">{{ item }}</li></ol></dd>
          <dd v-else-if="field.type === 'multi'" class="chip-list">
            <span v-for="item in response.answers[field.id]" :key="item" class="answer-chip">{{ item }}<small v-if="isOtherValue(field, item)">{{ t('form.other') }}</small></span>
          </dd>
          <dd v-else-if="['rating', 'scale', 'nps'].includes(field.type)" class="score-answer">
            <strong>{{ response.answers[field.id] }}</strong><span class="muted">/ {{ field.type === 'rating' ? field.ratingMax : field.type === 'nps' ? 10 : field.scaleMax }}</span>
          </dd>
          <dd v-else-if="field.type === 'url' && safeUrl(response.answers[field.id])"><a :href="safeUrl(response.answers[field.id])" target="_blank" rel="noopener noreferrer nofollow">{{ response.answers[field.id] }}</a></dd>
          <dd v-else class="preserve">{{ answerText(field, response.answers[field.id]) }}<small v-if="isOtherValue(field, response.answers[field.id])" class="answer-chip-tag">{{ t('form.other') }}</small></dd>
        </div>
      </dl>

      <footer class="detail-foot">
        <button type="button" class="button ghost small" @click="copyLink"><AppIcon name="link" :size="14" />{{ t('responses.copyLink') }}</button>
        <button type="button" class="button ghost small hide-mobile" @click="printPage"><AppIcon name="printer" :size="14" />{{ t('responses.print') }}</button>
        <span class="spacer"></span>
        <button v-if="writable && !response.deletedAt" type="button" class="button ghost small danger" @click="trash"><AppIcon name="trash" :size="14" />{{ t('responses.trash') }}</button>
        <button v-if="allowed('responses.write') && response.deletedAt" type="button" class="button ghost small" @click="restore"><AppIcon name="restore" :size="14" />{{ t('responses.restore') }}</button>
      </footer>
    </template>
  </section>
</template>
