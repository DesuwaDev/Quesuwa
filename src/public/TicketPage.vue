<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { t, displayError } from '../i18n.js';
import { api } from '../lib/api.js';
import { formatDate, formatBytes, formatMessageTime, shortId } from '../lib/format.js';
import { copyText } from '../lib/clipboard.js';
import { notify } from '../lib/feedback.js';
import { keyFromLocation, parseTicketInput, rememberTicket, savedTickets, ticketLink, forgetTicket } from '../lib/tickets.js';
import { formatAnswer } from '../../shared/answers.js';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { statusKeys } from '../../shared/constants.js';
import { startLive, sendKey } from '../lib/live.js';
import { trackReads } from '../lib/read-receipts.js';
import RichText from '../components/RichText.vue';
import MessageAttachments from '../components/MessageAttachments.vue';
import ComposerFiles from '../components/ComposerFiles.vue';
import MessageReactions from '../components/MessageReactions.vue';

const props = defineProps({ id: { type: String, required: true } });
const key = ref(keyFromLocation() || savedTickets().find(item => item.id === props.id)?.key || '');
const ticket = ref(null), error = ref(null), loading = ref(false), draft = ref(''), sending = ref(false), manual = ref('');
const thread = ref(null), files = ref([]), picker = ref(null);
const headers = () => ({ 'X-Ticket-Key': key.value });
const ticketPath = () => '/tickets/' + encodeURIComponent(props.id);

// Attachments are fetched with the key in a header and shown from blob URLs.
async function ticketFile(file, inline) {
  const response = await fetch('/api' + ticketPath() + '/files/' + encodeURIComponent(file.id) + (inline ? '?inline=1' : ''), { headers: headers() });
  if (!response.ok) throw new Error(String(response.status));
  return URL.createObjectURL(await response.blob());
}

const reads = trackReads(ids => api(ticketPath() + '/read', { method: 'POST', headers: headers(), body: { ids } }));

async function scrollToEnd() {
  await nextTick();
  thread.value?.scrollTo({ top: thread.value.scrollHeight, behavior: 'smooth' });
}
// Only follow new messages when the reader is already at the bottom of the thread.
const nearBottom = () => !thread.value || thread.value.scrollTop + thread.value.clientHeight >= thread.value.scrollHeight - 80;

// Replies that arrive while the tab is in the background show up as "(2) …" in the title.
const unseen = ref(0);
const baseTitle = () => ticket.value ? ticket.value.formTitle + ' · ' + t('app.brand') : t('app.brand');
const updateTitle = () => { document.title = (unseen.value ? `(${unseen.value}) ` : '') + baseTitle(); };

function apply(data, { follow = false } = {}) {
  const known = new Set((ticket.value?.messages || []).map(message => message.id));
  const incoming = ticket.value ? data.messages.filter(message => !known.has(message.id) && message.author !== 'respondent') : [];
  const stick = follow || nearBottom();
  ticket.value = data;
  if (incoming.length && document.visibilityState !== 'visible') unseen.value += incoming.length;
  updateTitle();
  if (stick && (incoming.length || follow)) scrollToEnd();
  nextTick(() => reads.observe(thread.value));
}

let stopLive = null;
const connection = ref('online');
const outbox = sendKey();
function watchTicket() {
  if (stopLive || !ticket.value) return;
  stopLive = startLive(async signal => {
    try {
      return await api(ticketPath() + '/wait?rev=' + encodeURIComponent(ticket.value.rev), { headers: headers(), signal });
    } catch (reason) {
      if (reason.code === 'errors.ticketNotFound') { error.value = reason; stopLive?.(); stopLive = null; }
      throw reason;
    }
  }, data => apply(data), { onStatus: value => { connection.value = value; } });
}

async function load(quiet = false) {
  if (!key.value) return;
  if (!quiet) loading.value = true;
  try {
    const data = await api('/tickets/' + encodeURIComponent(props.id), { headers: headers() });
    const first = !ticket.value;
    apply(data, { follow: first });
    error.value = null;
    rememberTicket({ id: props.id, key: key.value, title: ticket.value.formTitle });
    watchTicket();
  } catch (reason) {
    error.value = reason;
    if (reason.code === 'errors.ticketNotFound') forgetTicket(props.id);
  } finally { loading.value = false; }
}

// Respondents add or remove their own reactions; staff names come with the ticket.
const reactionsOf = message => (message.reactions || []).map(item => ({ ...item, names: [...item.names, ...(item.mine ? [t('ticket.me')] : [])] }));
async function react(message, emoji, on) {
  try { apply(await api(ticketPath() + '/messages/' + encodeURIComponent(message.id) + '/reactions', { method: 'POST', headers: headers(), body: { emoji, on } })); }
  catch (reason) { notify(reason.code || 'errors.operation', { type: 'error', params: reason.params || {} }); }
}

async function send() {
  if (!draft.value.trim() && !files.value.length) return;
  sending.value = true;
  try {
    let body = { body: draft.value };
    if (files.value.length) {
      body = new FormData();
      body.append('body', draft.value);
      for (const file of files.value) body.append('files', file);
    }
    const sendId = outbox.for(draft.value + '|' + files.value.map(file => file.name + file.size).join());
    apply(await api(ticketPath() + '/messages', { method: 'POST', headers: { ...headers(), 'Idempotency-Key': sendId }, body }), { follow: true });
    outbox.done();
    draft.value = '';
    files.value = [];
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

function onPaste(event) {
  const list = event.clipboardData?.files;
  if (list?.length && ticket.value?.files.allowed && picker.value?.add(list, true)) event.preventDefault();
}
function onDrop(event) { if (ticket.value?.files.allowed) picker.value?.add(event.dataTransfer?.files); }

const keydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') send(); };
const onVisible = () => { if (document.visibilityState === 'visible' && unseen.value) { unseen.value = 0; updateTitle(); } };
onMounted(() => { load(); document.addEventListener('visibilitychange', onVisible); });
onBeforeUnmount(() => { stopLive?.(); reads.stop(); document.removeEventListener('visibilitychange', onVisible); });

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
            <span class="muted small">{{ t('ticket.submittedAt', { date: formatDate(ticket.createdAt, { seconds: true }) }) }}</span>
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
              <time :datetime="message.createdAt" :title="formatDate(message.createdAt, { seconds: true })">{{ formatMessageTime(message.createdAt) }}</time>
            </div>
            <div v-else class="bubble" :class="message.author === 'staff' ? 'from-staff' : 'from-me'" :data-read-id="message.author === 'staff' ? message.id : undefined">
              <span class="bubble-author">{{ message.author === 'staff' ? t('ticket.staff', { name: message.authorName }) : t('ticket.me') }}</span>
              <RichText v-if="message.body" :text="message.body" />
              <MessageAttachments :files="message.attachments" :source="ticketFile" />
              <span class="bubble-foot">
                <MessageReactions :reactions="reactionsOf(message)" :can-react="ticket.canReply" @toggle="(emoji, on) => react(message, emoji, on)" />
                <time class="bubble-time" :datetime="message.createdAt" :title="formatDate(message.createdAt, { seconds: true })">{{ formatMessageTime(message.createdAt) }}</time>
              </span>
            </div>
          </template>
        </div>
        <p v-if="connection === 'offline'" class="banner warning live-offline" role="status"><AppIcon name="alert" :size="16" /><span>{{ t('ticket.offline') }}</span></p>
        <form v-if="ticket.canReply" class="ticket-composer" @submit.prevent="send" @dragover.prevent @drop.prevent="onDrop">
          <textarea v-model="draft" class="input textarea autosize" rows="2" maxlength="5000" :placeholder="t('ticket.replyPlaceholder')" :aria-label="t('ticket.replyPlaceholder')" @keydown="keydown" @paste="onPaste"></textarea>
          <ComposerFiles v-if="ticket.files.allowed" ref="picker" v-model="files" :max="ticket.files.max" :max-m-b="ticket.files.maxMB" />
          <div class="ticket-composer-foot">
            <button v-if="ticket.files.allowed" type="button" class="icon-button ghost" :aria-label="t('ticket.attach')" :title="t('ticket.attach')" :disabled="files.length >= ticket.files.max" @click="picker?.pick()"><AppIcon name="paperclip" :size="18" /></button>
            <small class="muted">{{ ticket.files.allowed ? t('ticket.composeHintFiles') : t('ticket.composeHint') }}</small>
            <button type="submit" class="button primary" :disabled="sending || (!draft.trim() && !files.length)"><AppIcon name="send" :size="16" />{{ sending ? t('form.submitting') : t('ticket.send') }}</button>
          </div>
        </form>
        <p v-else-if="ticket.closed" class="banner ticket-locked">
          <AppIcon name="lock" :size="16" /><span>{{ t('ticket.locked') }}</span>
          <a v-if="ticket.formSlug" class="text-button small" :href="'/f/' + ticket.formSlug">{{ t('ticket.newReport') }}</a>
        </p>
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
