<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { t, displayError } from '../i18n.js';
import { api } from '../lib/api.js';
import { formatDate, formatBytes, relativeTime, shortId } from '../lib/format.js';
import { copyText } from '../lib/clipboard.js';
import { notify } from '../lib/feedback.js';
import { keyFromLocation, parseTicketInput, rememberTicket, savedTickets, ticketLink, forgetTicket } from '../lib/tickets.js';
import { formatAnswer } from '../../shared/answers.js';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { statusKeys } from '../../shared/constants.js';

const props = defineProps({ id: { type: String, required: true } });
const key = ref(keyFromLocation() || savedTickets().find(item => item.id === props.id)?.key || '');
const ticket = ref(null), error = ref(null), loading = ref(false), draft = ref(''), sending = ref(false), manual = ref('');
const thread = ref(null);
const headers = () => ({ 'X-Ticket-Key': key.value });

async function scrollToEnd() {
  await nextTick();
  thread.value?.scrollTo({ top: thread.value.scrollHeight, behavior: 'smooth' });
}

async function load(quiet = false) {
  if (!key.value) return;
  if (!quiet) loading.value = true;
  try {
    const previous = ticket.value?.messages.length;
    ticket.value = await api('/tickets/' + encodeURIComponent(props.id), { headers: headers() });
    error.value = null;
    rememberTicket({ id: props.id, key: key.value, title: ticket.value.formTitle });
    document.title = ticket.value.formTitle + ' · ' + t('app.brand');
    if (previous !== ticket.value.messages.length) scrollToEnd();
  } catch (reason) {
    error.value = reason;
    if (reason.code === 'errors.ticketNotFound') forgetTicket(props.id);
  } finally { loading.value = false; }
}

async function send() {
  if (!draft.value.trim()) return;
  sending.value = true;
  try {
    ticket.value = await api('/tickets/' + encodeURIComponent(props.id) + '/messages', { method: 'POST', headers: headers(), body: { body: draft.value } });
    draft.value = '';
    scrollToEnd();
  } catch (reason) { notify(reason.code || 'errors.operation', { type: 'error', params: reason.params || {} }); }
  finally { sending.value = false; }
}

function useManual() {
  const parsed = parseTicketInput(manual.value, props.id);
  if (!parsed) return;
  key.value = parsed.key;
  load();
}

async function copyLink() {
  if (await copyText(ticketLink(props.id, key.value))) notify('ticket.linkCopied');
}

const keydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') send(); };
const onVisible = () => { if (document.visibilityState === 'visible' && ticket.value) load(true); };
onMounted(() => { load(); document.addEventListener('visibilitychange', onVisible); });
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));

const answerOf = field => field.type === 'file'
  ? (field.value || []).map(file => `${file.name} (${formatBytes(file.size)})`).join(t('common.listSeparator'))
  : formatAnswer(field, field.value, t('common.listSeparator'));
</script>

<template>
  <div class="ticket-page">
    <form v-if="!key || (error && error.code === 'errors.ticketNotFound')" class="state-panel access-gate" @submit.prevent="useManual">
      <span class="state-icon"><AppIcon name="key" :size="28" /></span>
      <h1>{{ t('ticket.needKey') }}</h1>
      <p>{{ error ? displayError(error) : t('ticket.needKeyHint') }}</p>
      <label class="field">
        <span class="field-label">{{ t('ticket.linkLabel') }}</span>
        <input v-model="manual" class="input mono" autocomplete="off" autofocus />
      </label>
      <button class="button primary block" type="submit" :disabled="!manual.trim()">{{ t('ticket.open') }}</button>
    </form>

    <div v-else-if="!ticket" class="state-panel" :aria-busy="loading">
      <template v-if="error">
        <span class="state-icon"><AppIcon name="alert" :size="28" /></span>
        <p>{{ displayError(error) }}</p>
        <button type="button" class="button" @click="load()"><AppIcon name="refresh" :size="16" />{{ t('common.retry') }}</button>
      </template>
      <span v-else class="spinner"></span>
    </div>

    <template v-else>
      <header class="ticket-head card">
        <div class="ticket-head-main">
          <span class="eyebrow">{{ t('ticket.eyebrow') }}</span>
          <h1>{{ ticket.formTitle }}</h1>
          <div class="ticket-meta">
            <span class="mono">#{{ shortId(ticket.id) }}</span>
            <StatusBadge :status="ticket.status" />
            <span class="muted small">{{ t('ticket.submittedAt', { date: formatDate(ticket.createdAt) }) }}</span>
          </div>
        </div>
        <div class="ticket-head-actions">
          <button type="button" class="button ghost small" @click="copyLink"><AppIcon name="link" :size="14" />{{ t('ticket.copyLink') }}</button>
          <button type="button" class="icon-button ghost" :aria-label="t('common.refresh')" :title="t('common.refresh')" @click="load()"><AppIcon name="refresh" :size="16" /></button>
        </div>
      </header>

      <section class="card ticket-thread-card">
        <h2 class="card-title">{{ t('ticket.conversation') }}</h2>
        <div ref="thread" class="ticket-thread" aria-live="polite">
          <p v-if="!ticket.messages.length" class="muted center small">{{ t('ticket.noMessages') }}</p>
          <template v-for="message in ticket.messages" :key="message.id">
            <div v-if="message.author === 'system'" class="timeline-event">
              <span>{{ t('ticket.statusEvent', { status: t(statusKeys[message.body.replace(/^status:/, '')] || 'status.pending') }) }}</span>
              <time :datetime="message.createdAt" :title="formatDate(message.createdAt)">{{ relativeTime(message.createdAt) }}</time>
            </div>
            <div v-else class="bubble" :class="message.author === 'staff' ? 'from-staff' : 'from-me'">
              <span class="bubble-author">{{ message.author === 'staff' ? t('ticket.staff', { name: message.authorName }) : t('ticket.me') }}</span>
              <p class="preserve">{{ message.body }}</p>
              <time class="bubble-time" :datetime="message.createdAt" :title="formatDate(message.createdAt)">{{ relativeTime(message.createdAt) }}</time>
            </div>
          </template>
        </div>
        <form v-if="ticket.canReply" class="ticket-composer" @submit.prevent="send">
          <textarea v-model="draft" class="input textarea autosize" rows="2" maxlength="5000" :placeholder="t('ticket.replyPlaceholder')" :aria-label="t('ticket.replyPlaceholder')" @keydown="keydown"></textarea>
          <div class="ticket-composer-foot">
            <small class="muted">{{ t('ticket.sendHint') }}</small>
            <button type="submit" class="button primary" :disabled="sending || !draft.trim()"><AppIcon name="send" :size="16" />{{ sending ? t('form.submitting') : t('ticket.send') }}</button>
          </div>
        </form>
        <p v-else class="banner"><AppIcon name="lock" :size="16" />{{ t('ticket.closed') }}</p>
      </section>

      <details class="card ticket-answers">
        <summary>{{ t('ticket.mySubmission') }}</summary>
        <dl class="answer-list">
          <div v-for="(field, index) in ticket.fields" :key="field.id" class="answer-item">
            <dt><span class="answer-number">{{ index + 1 }}</span>{{ field.label }}</dt>
            <dd class="preserve" :class="{ muted: !answerOf(field) }">{{ answerOf(field) || t('responses.unanswered') }}</dd>
          </div>
        </dl>
      </details>
      <p class="form-privacy"><AppIcon name="lock" :size="13" />{{ t('ticket.privacy') }}</p>
    </template>
  </div>
</template>
