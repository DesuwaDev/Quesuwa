<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n.js';
import { api, allowed } from '../../lib/api.js';
import { notify, notifyError, confirmDialog } from '../../lib/feedback.js';
import { copyText } from '../../lib/clipboard.js';
import { formatDate, formatDuration, formatBytes, shortId } from '../../lib/format.js';
import { statuses } from '../../../shared/constants.js';
import { answerable } from '../../../shared/schema.js';
import { isAnswered, isOtherValue } from '../../../shared/answers.js';
import { parseAgent, environmentSummary } from '../../../shared/environment.js';
import AppIcon from '../../components/AppIcon.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { answerText } from './format.js';
import ConversationPanel from './ConversationPanel.vue';
import { storage } from '../../lib/storage.js';
import { messaging, loadMessaging } from '../../lib/messaging.js';
import { startLive } from '../../lib/live.js';

const props = defineProps({ responseId: String, form: Object, hasPrevious: Boolean, hasNext: Boolean, writable: Boolean });
const emit = defineEmits(['close', 'previous', 'next', 'updated', 'removed']);
const response = ref(null), error = ref(null), note = ref(''), savingNote = ref(false);
const notifyStatus = ref(storage.get('quesuwa.statusEmail') === '1');
watch(notifyStatus, value => storage.set('quesuwa.statusEmail', value ? '1' : '0'));
const canEmail = computed(() => messaging.mail && Boolean(response.value?.contactEmail));
const fields = computed(() => response.value?.snapshot.fields.filter(answerable) || []);
const noteDirty = computed(() => response.value && note.value.trim() !== response.value.note);
const files = fieldId => response.value.attachments.filter(file => file.fieldId === fieldId);
const fileUrl = file => '/api/admin/responses/' + response.value.id + '/files/' + file.id;
const isImage = file => /^image\/(png|jpeg|webp|gif)$/.test(file.mime);
const safeUrl = value => /^https?:\/\//i.test(value) ? value : '';
// Browser diagnostics, when the questionnaire collected them.
const environmentRows = computed(() => {
  const env = response.value?.environment;
  if (!env) return [];
  const { browser, system } = parseAgent(env.userAgent);
  let localTime = '';
  try { if (env.timeZone) localTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: env.timeZone }).format(new Date(response.value.createdAt)); } catch { localTime = ''; }
  return [
    ['environment.browser', browser],
    ['environment.system', [system, env.platform && !system.startsWith(env.platform) ? env.platform : ''].filter(Boolean).join(' · ')],
    ['environment.device', [t(env.mobile ? 'environment.mobile' : 'environment.desktop'), env.touch ? t('environment.touch') : ''].filter(Boolean).join(' · ')],
    ['environment.screenSize', env.screen && env.screen.replace('x', '×') + (env.pixelRatio ? ` @${env.pixelRatio}x` : '')],
    ['environment.viewport', env.viewport && env.viewport.replace('x', '×')],
    ['environment.language', env.language],
    ['environment.timeZone', [env.timeZone, localTime && t('environment.localTime', { time: localTime })].filter(Boolean).join(' · ')],
    ['environment.theme', env.colorScheme && t(env.colorScheme === 'dark' ? 'environment.dark' : 'environment.light')],
    ['environment.referrer', env.referrer],
    ['environment.page', env.page]
  ].filter(([, value]) => value);
});
async function copyEnvironment() {
  const lines = environmentRows.value.map(([key, value]) => `${t(key)}: ${value}`);
  lines.push(`${t('environment.userAgent')}: ${response.value.environment.userAgent}`);
  if (await copyText(lines.join('\n'))) notify('share.copied');
}
const languageKey = code => ({ 'zh-CN': 'language.zhCN', en: 'language.en' })[code];

async function markRead() {
  if (!response.value?.unread) return;
  response.value.unread = false;
  emit('updated', { id: response.value.id, unread: false });
  try { await api('/admin/responses/' + props.responseId + '/read', { method: 'POST', body: {} }); } catch { /* Retried on the next visit. */ }
}

// Conversations update live: new respondent replies, status changes and email delivery results.
let stopLive = null;
const connection = ref('online');
function applyLive(state) {
  const current = response.value;
  if (!current) return;
  Object.assign(current, { messages: state.messages, status: state.status, unread: state.unread, lastActivityAt: state.lastActivityAt, rev: state.rev, filesDisabled: state.filesDisabled });
  emit('updated', { id: current.id, status: state.status, unread: state.unread, lastActivityAt: state.lastActivityAt, messageCount: state.messages.length });
  if (state.unread && document.visibilityState === 'visible') markRead();
}
const onVisible = () => { if (document.visibilityState === 'visible') markRead(); };

async function load() {
  try {
    response.value = await api('/admin/responses/' + props.responseId);
    note.value = response.value.note;
    if (document.visibilityState === 'visible') markRead();
    if (response.value.conversation && !stopLive) {
      stopLive = startLive(signal => api('/admin/responses/' + props.responseId + '/wait?rev=' + encodeURIComponent(response.value.rev), { signal }), applyLive, { onStatus: value => { connection.value = value; } });
    }
  } catch (reason) { error.value = reason; }
}

async function patch(body, messageKey) {
  try {
    const { event, delivery, ...updated } = await api('/admin/responses/' + response.value.id, { method: 'PATCH', body });
    Object.assign(response.value, updated);
    // Live sync may already have delivered this status update.
    if (event && !response.value.messages.some(message => message.id === event.id)) response.value.messages.push(event);
    note.value = updated.note;
    emit('updated', updated);
    if (delivery?.queued) notify('ticket.statusQueued', { type: 'info', timeout: 6000 });
    else if (delivery && !delivery.ok) notify('ticket.emailFailed', { type: 'error', params: { error: delivery.error || '—' }, timeout: 8000 });
    else if (delivery) notify('ticket.statusEmailed', { params: { email: response.value.contactEmail } });
    else if (messageKey) notify(messageKey);
  } catch (reason) { notifyError(reason); }
}
// A status is chosen first and applied with the confirm button, so a stray tap changes nothing.
const chosenStatus = ref(null), savingStatus = ref(false);
const shownStatus = computed(() => chosenStatus.value ?? response.value?.status);
const chooseStatus = status => { chosenStatus.value = status === response.value.status ? null : status; };
async function applyStatus() {
  const status = chosenStatus.value;
  if (!status || savingStatus.value) return;
  savingStatus.value = true;
  await patch({ status, notify: canEmail.value && notifyStatus.value }, 'responses.statusSaved');
  savingStatus.value = false;
  // A failed save keeps the choice so it can be retried.
  if (response.value?.status === status) chosenStatus.value = null;
}
// A live update that reaches the chosen status settles the choice.
watch(() => response.value?.status, value => { if (chosenStatus.value === value) chosenStatus.value = null; });
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
onMounted(() => { load(); loadMessaging(); window.addEventListener('keydown', keys); document.addEventListener('visibilitychange', onVisible); });
onBeforeUnmount(() => { stopLive?.(); window.removeEventListener('keydown', keys); document.removeEventListener('visibilitychange', onVisible); });
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
        <span><AppIcon name="clock" :size="14" />{{ formatDate(response.createdAt, { seconds: true }) }}</span>
        <span v-if="response.durationMs"><AppIcon name="activity" :size="14" />{{ t('responses.duration', { time: formatDuration(response.durationMs) }) }}</span>
        <span v-if="languageKey(response.locale)"><AppIcon name="globe" :size="14" />{{ t(languageKey(response.locale)) }}</span>
        <span v-if="response.contactEmail"><AppIcon name="mail" :size="14" /><a :href="'mailto:' + response.contactEmail">{{ response.contactEmail }}</a></span>
        <span v-if="response.environment"><AppIcon name="monitor" :size="14" />{{ environmentSummary(response.environment) }}</span>
        <span><AppIcon name="layers" :size="14" />{{ t('responses.version', { version: response.snapshot.version }) }}</span>
        <span v-if="response.deletedAt" class="badge muted">{{ t('responses.inTrash') }}</span>
      </div>

      <ConversationPanel v-if="response.conversation" :response="response" :writable="writable" :offline="connection === 'offline'" @updated="emit('updated', $event)" />

      <div class="review-panel">
        <div class="review-row">
          <span class="field-label">{{ t('responses.status') }}</span>
          <div class="status-line">
            <div class="status-picker" role="radiogroup" :aria-label="t('responses.status')">
              <button v-for="status in statuses" :key="status" type="button" role="radio" :aria-checked="shownStatus === status" :class="{ active: shownStatus === status, current: chosenStatus && response.status === status }" :disabled="!writable" @click="chooseStatus(status)"><StatusBadge :status="status" /></button>
            </div>
            <button v-if="writable" type="button" class="button small status-apply" :class="{ primary: chosenStatus }" :disabled="!chosenStatus || savingStatus" @click="applyStatus"><AppIcon name="check" :size="14" />{{ t('responses.applyStatus') }}</button>
          </div>
          <label v-if="canEmail && writable" class="check-row small"><input v-model="notifyStatus" type="checkbox" />{{ t('ticket.notifyOnStatus', { email: response.contactEmail }) }}</label>
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

      <section v-if="response.environment" class="environment-panel">
        <header>
          <h3><AppIcon name="monitor" :size="16" />{{ t('environment.title') }}</h3>
          <button type="button" class="button ghost small" @click="copyEnvironment"><AppIcon name="copy" :size="14" />{{ t('environment.copy') }}</button>
        </header>
        <dl>
          <div v-for="[key, value] in environmentRows" :key="key">
            <dt>{{ t(key) }}</dt>
            <dd v-if="key === 'environment.referrer' && safeUrl(value)"><a :href="safeUrl(value)" target="_blank" rel="noopener noreferrer nofollow">{{ value }}</a></dd>
            <dd v-else>{{ value }}</dd>
          </div>
        </dl>
        <details>
          <summary>{{ t('environment.userAgent') }}</summary>
          <code class="mono">{{ response.environment.userAgent }}</code>
        </details>
      </section>

      <details v-if="response.snapshot.consent" class="consent-record">
        <summary><AppIcon name="shield" :size="14" />{{ t('responses.consentAccepted') }}</summary>
        <p class="preserve">{{ response.snapshot.consent.text }}</p>
      </details>

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
