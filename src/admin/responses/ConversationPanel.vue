<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n.js';
import { api, session } from '../../lib/api.js';
import { notify, notifyError, confirmDialog } from '../../lib/feedback.js';
import { copyText } from '../../lib/clipboard.js';
import { formatDate, formatMessageTime } from '../../lib/format.js';

const formatTime = value => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
import { storage } from '../../lib/storage.js';
import { messaging, loadMessaging } from '../../lib/messaging.js';
import { statuses, statusKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import MenuButton from '../../components/MenuButton.vue';
import { sendKey } from '../../lib/live.js';
import { LIMITS } from '../../../shared/constants.js';
import RichText from '../../components/RichText.vue';
import MessageAttachments from '../../components/MessageAttachments.vue';
import ComposerFiles from '../../components/ComposerFiles.vue';
import ToggleSwitch from '../../components/ToggleSwitch.vue';
import MessageReactions from '../../components/MessageReactions.vue';

// Staff ↔ respondent messages, status timeline and optional email delivery.
const props = defineProps({ response: { type: Object, required: true }, writable: Boolean, offline: Boolean });
const outbox = sendKey();
const emit = defineEmits(['updated']);
const reply = ref(''), replyStatus = ref(''), sending = ref(false), thread = ref(null);
const files = ref([]), picker = ref(null);
const editing = ref(null), editText = ref(''), savingEdit = ref(false), originals = ref({});
const fileUrl = (file, inline) => `/api/admin/responses/${props.response.id}/conversation-files/${file.id}${inline ? '?inline=1' : ''}`;
const sendEmail = ref(storage.get('quesuwa.replyEmail') !== '0');
const canEmail = computed(() => messaging.mail && Boolean(props.response.contactEmail));
watch(sendEmail, value => storage.set('quesuwa.replyEmail', value ? '1' : '0'));

const statusOf = message => message.body.replace(/^status:/, '');
const author = message => message.author === 'staff' ? message.authorName : message.author === 'respondent' ? t('ticket.respondent') : '';

async function scrollToEnd() {
  await nextTick();
  thread.value?.scrollTo({ top: thread.value.scrollHeight, behavior: 'smooth' });
}
onMounted(() => { loadMessaging(); scrollToEnd(); });
// Follow live messages only when the thread is already scrolled to the bottom.
let atBottom = true;
const trackScroll = () => { atBottom = !thread.value || thread.value.scrollTop + thread.value.clientHeight >= thread.value.scrollHeight - 80; };
watch(() => props.response.messages.length, (count, previous) => { if (count > previous && atBottom) scrollToEnd(); });

function reportDelivery(delivery, successKey) {
  if (!delivery) return notify(successKey);
  if (delivery.queued) return notify('ticket.emailQueued', { type: 'info', params: { time: formatTime(delivery.dueAt) }, timeout: 6000 });
  if (delivery.ok) notify('ticket.emailSent', { params: { email: props.response.contactEmail } });
  else notify('ticket.emailFailed', { type: 'error', params: { error: delivery.error || '—' }, timeout: 8000 });
}

async function send() {
  if (!reply.value.trim() && !files.value.length) return;
  sending.value = true;
  try {
    const fields = { body: reply.value, email: canEmail.value && sendEmail.value, ...(replyStatus.value ? { status: replyStatus.value } : {}) };
    let body = fields;
    if (files.value.length) {
      body = new FormData();
      for (const [name, value] of Object.entries(fields)) body.append(name, String(value));
      for (const file of files.value) body.append('files', file);
    }
    const data = await api('/admin/responses/' + props.response.id + '/messages', { method: 'POST', headers: { 'Idempotency-Key': outbox.for(reply.value + '|' + files.value.map(file => file.name + file.size).join()) }, body });
    outbox.done();
    files.value = [];
    // Live updates may already have delivered these messages.
    for (const item of [data.message, data.event]) if (item && !props.response.messages.some(message => message.id === item.id)) props.response.messages.push(item);
    props.response.status = data.response.status;
    props.response.lastActivityAt = data.response.lastActivityAt;
    emit('updated', { id: props.response.id, status: data.response.status, unread: false, messageCount: props.response.messages.length });
    reply.value = '';
    replyStatus.value = '';
    reportDelivery(data.delivery, 'ticket.replySent');
    scrollToEnd();
  } catch (reason) { notifyError(reason); }
  finally { sending.value = false; }
}

async function resend(message) {
  message.delivery = 'pending';
  try {
    const data = await api('/admin/responses/' + props.response.id + '/messages/' + message.id + '/resend', { method: 'POST', body: {} });
    message.delivery = data.message.delivery;
    reportDelivery(data.delivery);
  } catch (reason) { message.delivery = 'failed'; notifyError(reason); }
}

// Editing and retracting are invisible to the respondent; staff keep the original and a marker.
function startEdit(message) {
  editing.value = message.id;
  editText.value = message.body;
}
async function saveEdit(message) {
  savingEdit.value = true;
  try {
    const data = await api(`/admin/responses/${props.response.id}/messages/${message.id}`, { method: 'PATCH', body: { body: editText.value } });
    Object.assign(message, data.message);
    editing.value = null;
    notify('ticket.edited');
  } catch (reason) { notifyError(reason); }
  finally { savingEdit.value = false; }
}
async function retract(message) {
  if (!(await confirmDialog({ titleKey: 'ticket.retract', messageKey: 'ticket.retractConfirm', confirmKey: 'ticket.retract', danger: true }))) return;
  try { Object.assign(message, (await api(`/admin/responses/${props.response.id}/messages/${message.id}`, { method: 'DELETE' })).message); notify('ticket.retracted'); }
  catch (reason) { notifyError(reason); }
}
async function restore(message) {
  try { Object.assign(message, (await api(`/admin/responses/${props.response.id}/messages/${message.id}/restore`, { method: 'POST', body: {} })).message); notify('ticket.restored'); }
  catch (reason) { notifyError(reason); }
}
const toggleOriginal = message => { originals.value = { ...originals.value, [message.id]: !originals.value[message.id] }; };

// Respondent uploads can be switched off for this conversation only.
async function setFiles(allowed) {
  try {
    const data = await api('/admin/responses/' + props.response.id, { method: 'PATCH', body: { filesDisabled: !allowed } });
    props.response.filesDisabled = data.filesDisabled;
  } catch (reason) { notifyError(reason); }
}
function onPaste(event) {
  const list = event.clipboardData?.files;
  if (list?.length && picker.value?.add(list, true)) event.preventDefault();
}
function onDrop(event) { picker.value?.add(event.dataTransfer?.files); }

const insert = template => { reply.value = reply.value.trim() ? reply.value.trimEnd() + '\n\n' + template.body : template.body; };
const keys = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') send(); };
// Reactions as staff see them: who reacted, with "you" for the signed-in staff member.
function reactionsOf(message) {
  return (message.reactions || []).map(item => {
    const mine = item.staff.some(person => person.id === session.user?.id);
    const names = item.staff.map(person => person.id === session.user?.id ? t('reactions.you') : person.name);
    return { emoji: item.emoji, count: item.count, mine, names: item.respondent ? [...names, t('ticket.respondent')] : names };
  });
}
async function react(message, emoji, on) {
  try {
    const data = await api(`/admin/responses/${props.response.id}/messages/${message.id}/reactions`, { method: 'POST', body: { emoji, on } });
    props.response.messages = data.messages;
  } catch (reason) { notifyError(reason); }
}
async function copyFollowUp() {
  if (await copyText(props.response.followUpUrl)) notify('ticket.linkCopied');
}
// A new link makes every earlier one stop working; revoking leaves the respondent with none.
async function changeLink(action, doneKey) {
  try {
    const data = await api(`/admin/responses/${props.response.id}/follow-up`, { method: 'POST', body: { action } });
    props.response.followUpUrl = data.followUpUrl;
    props.response.ticket = data.ticket;
    notify(doneKey);
  } catch (reason) { notifyError(reason); }
}
async function reissueLink() {
  if (props.response.followUpUrl && !(await confirmDialog({ titleKey: 'ticket.reissueLink', messageKey: 'ticket.reissueConfirm', confirmKey: 'ticket.reissueLink' }))) return;
  await changeLink('reissue', 'ticket.linkReissued');
}
async function revokeLink() {
  if (!(await confirmDialog({ titleKey: 'ticket.revokeLink', messageKey: 'ticket.revokeConfirm', confirmKey: 'ticket.revokeLink', danger: true }))) return;
  await changeLink('revoke', 'ticket.linkRevoked');
}
defineExpose({ scrollToEnd });
</script>

<template>
  <section class="ticket-admin">
    <header class="ticket-admin-head">
      <AppIcon name="message" :size="16" /><strong>{{ t('ticket.conversation') }}</strong>
      <span class="spacer"></span>
      <button v-if="response.followUpUrl" type="button" class="text-button small" @click="copyFollowUp"><AppIcon name="link" :size="14" />{{ t('ticket.copyRespondentLink') }}</button>
      <MenuButton v-if="writable && response.canIssueLink" :label="t('ticket.linkActions')" icon="more" button-class="icon-button ghost small">
        <button type="button" class="menu-item" @click="reissueLink"><AppIcon name="link" :size="16" />{{ response.followUpUrl ? t('ticket.reissueLink') : t('ticket.issueLink') }}</button>
        <button v-if="response.followUpUrl" type="button" class="menu-item danger" @click="revokeLink"><AppIcon name="trash" :size="16" />{{ t('ticket.revokeLink') }}</button>
      </MenuButton>
    </header>
    <ToggleSwitch v-if="response.ticket && response.filesAllowed && writable" class="compact" :model-value="!response.filesDisabled" :label="t('ticket.respondentFiles')" :hint="t('ticket.respondentFilesHint')" @update:model-value="setFiles" />
    <p class="muted small">{{ response.ticket ? t('ticket.adminHint') : response.canIssueLink ? t('ticket.linkRevokedHint') : t('ticket.emailOnlyHint') }}</p>
    <div ref="thread" class="ticket-thread compact" @scroll.passive="trackScroll">
      <p v-if="!response.messages.length" class="muted small">{{ t('ticket.adminEmpty') }}</p>
      <template v-for="message in response.messages" :key="message.id">
        <div v-if="message.author === 'system'" class="timeline-event">
          <span>{{ t('ticket.statusEvent', { status: t(statusKeys[statusOf(message)] || 'status.pending') }) }}</span>
          <time :datetime="message.createdAt" :title="formatDate(message.createdAt, { seconds: true })">{{ formatMessageTime(message.createdAt) }}</time>
          <span v-if="message.delivery" class="delivery" :class="message.delivery">{{ t('ticket.delivery.' + message.delivery) }}</span>
          <button v-if="message.delivery === 'failed' && writable" type="button" class="text-button small" @click="resend(message)">{{ t('ticket.resend') }}</button>
        </div>
        <div v-else class="bubble" :class="[message.author === 'staff' ? 'from-me' : 'from-staff', { retracted: message.deletedAt }]">
          <span class="bubble-head">
            <span class="bubble-author">{{ author(message) }}</span>
            <span v-if="message.deletedAt" class="bubble-tag danger" :title="t('ticket.retractedBy', { name: message.deletedBy, time: formatDate(message.deletedAt, { seconds: true }) })">{{ t('ticket.retractedTag') }}</span>
            <button v-if="message.editedAt" type="button" class="bubble-tag" :aria-expanded="Boolean(originals[message.id])" :title="t('ticket.editedBy', { name: message.editedBy, time: formatDate(message.editedAt, { seconds: true }) })" @click="toggleOriginal(message)">{{ t('ticket.editedTag') }}</button>
            <MenuButton v-if="writable && editing !== message.id" class="bubble-menu" :label="t('ticket.messageActions')" icon="more" button-class="icon-button ghost small">
              <button v-if="!message.deletedAt" type="button" class="menu-item" @click="startEdit(message)"><AppIcon name="edit" :size="16" />{{ t('ticket.edit') }}</button>
              <button v-if="!message.deletedAt" type="button" class="menu-item danger" @click="retract(message)"><AppIcon name="trash" :size="16" />{{ t('ticket.retract') }}</button>
              <button v-else type="button" class="menu-item" @click="restore(message)"><AppIcon name="restore" :size="16" />{{ t('ticket.restore') }}</button>
            </MenuButton>
          </span>
          <form v-if="editing === message.id" class="bubble-edit" @submit.prevent="saveEdit(message)">
            <textarea v-model="editText" class="input textarea autosize" rows="3" maxlength="5000" :aria-label="t('ticket.edit')" @keydown.esc="editing = null"></textarea>
            <span class="bubble-edit-actions">
              <button type="button" class="button ghost small" @click="editing = null">{{ t('common.cancel') }}</button>
              <button type="submit" class="button primary small" :disabled="savingEdit || (!editText.trim() && !message.attachments.length)">{{ t('common.save') }}</button>
            </span>
          </form>
          <template v-else>
            <RichText v-if="message.body" :text="message.body" />
            <MessageAttachments :files="message.attachments" :source="fileUrl" />
            <div v-if="message.editedAt && originals[message.id]" class="bubble-original">
              <span class="muted small">{{ t('ticket.originalText') }}</span>
              <RichText :text="message.originalBody || ''" />
            </div>
          </template>
          <span class="bubble-foot">
            <MessageReactions :reactions="reactionsOf(message)" :can-react="writable && !message.deletedAt" @toggle="(emoji, on) => react(message, emoji, on)" />
            <span v-if="message.delivery" class="delivery" :class="message.delivery"><AppIcon :name="message.delivery === 'failed' ? 'alert' : 'mail'" :size="12" />{{ t('ticket.delivery.' + message.delivery) }}</span>
            <button v-if="message.delivery === 'failed' && writable" type="button" class="text-button small" @click="resend(message)">{{ t('ticket.resend') }}</button>
            <span v-if="message.author === 'staff' && response.ticket && !message.deletedAt" class="read-receipt" :class="{ read: message.readAt }" :title="message.readAt ? formatDate(message.readAt, { seconds: true }) : ''">
              <AppIcon :name="message.readAt ? 'checkCircle' : 'circle'" :size="12" />{{ message.readAt ? t('ticket.readAt', { time: formatMessageTime(message.readAt) }) : t('ticket.unreadByRespondent') }}
            </span>
            <time class="bubble-time" :datetime="message.createdAt" :title="formatDate(message.createdAt, { seconds: true })">{{ formatMessageTime(message.createdAt) }}</time>
          </span>
        </div>
      </template>
    </div>
    <p v-if="offline" class="banner warning live-offline" role="status"><AppIcon name="alert" :size="16" /><span>{{ t('ticket.offlineStaff') }}</span></p>
    <p v-if="response.status === 'closed'" class="hint small"><AppIcon name="lock" :size="14" />{{ t('ticket.lockedStaff') }}</p>
    <form v-if="writable" class="ticket-composer" @submit.prevent="send" @dragover.prevent @drop.prevent="onDrop">
      <textarea v-model="reply" class="input textarea autosize" rows="2" maxlength="5000" :placeholder="t('ticket.adminPlaceholder')" :aria-label="t('ticket.adminPlaceholder')" @keydown="keys" @paste="onPaste"></textarea>
      <ComposerFiles ref="picker" v-model="files" :max="LIMITS.messageFiles" :max-m-b="LIMITS.fileMB" />
      <div class="ticket-composer-foot">
        <button type="button" class="icon-button ghost small" :aria-label="t('ticket.attach')" :title="t('ticket.attach')" :disabled="files.length >= LIMITS.messageFiles" @click="picker?.pick()"><AppIcon name="paperclip" :size="16" /></button>
        <MenuButton v-if="messaging.templates.length" :label="t('ticket.templates')" icon="quote" :text="t('ticket.templates')" button-class="button ghost small" align="start">
          <button v-for="template in messaging.templates" :key="template.id" type="button" class="menu-item" @click="insert(template)"><span>{{ template.title }}<small class="clamp-1">{{ template.body }}</small></span></button>
        </MenuButton>
        <select v-model="replyStatus" class="input select compact" :aria-label="t('ticket.statusAfter')">
          <option value="">{{ t('ticket.keepStatus') }}</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ t('ticket.setStatus', { status: t(statusKeys[status]) }) }}</option>
        </select>
        <span class="spacer"></span>
        <label v-if="canEmail" class="check-row small" :title="response.contactEmail"><input v-model="sendEmail" type="checkbox" />{{ t('ticket.alsoEmail') }}</label>
        <button type="submit" class="button primary small" :disabled="sending || (!reply.trim() && !files.length)"><AppIcon name="send" :size="14" />{{ sending ? t('form.submitting') : t('ticket.send') }}</button>
      </div>
    </form>
  </section>
</template>
