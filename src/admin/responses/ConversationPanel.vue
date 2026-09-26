<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n.js';
import { api } from '../../lib/api.js';
import { notify, notifyError } from '../../lib/feedback.js';
import { copyText } from '../../lib/clipboard.js';
import { formatDate } from '../../lib/format.js';
import { storage } from '../../lib/storage.js';
import { messaging, loadMessaging } from '../../lib/messaging.js';
import { statuses, statusKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import MenuButton from '../../components/MenuButton.vue';

// Staff ↔ respondent messages, status timeline and optional email delivery.
const props = defineProps({ response: { type: Object, required: true }, writable: Boolean });
const emit = defineEmits(['updated']);
const reply = ref(''), replyStatus = ref(''), sending = ref(false), thread = ref(null);
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

function reportDelivery(delivery, successKey) {
  if (!delivery) return notify(successKey);
  if (delivery.ok) notify('ticket.emailSent', { params: { email: props.response.contactEmail } });
  else notify('ticket.emailFailed', { type: 'error', params: { error: delivery.error || '—' }, timeout: 8000 });
}

async function send() {
  if (!reply.value.trim()) return;
  sending.value = true;
  try {
    const data = await api('/admin/responses/' + props.response.id + '/messages', { method: 'POST', body: { body: reply.value, email: canEmail.value && sendEmail.value, ...(replyStatus.value ? { status: replyStatus.value } : {}) } });
    props.response.messages.push(data.message, ...(data.event ? [data.event] : []));
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

const insert = template => { reply.value = reply.value.trim() ? reply.value.trimEnd() + '\n\n' + template.body : template.body; };
const keys = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') send(); };
async function copyFollowUp() {
  if (await copyText(props.response.followUpUrl)) notify('ticket.linkCopied');
}
defineExpose({ scrollToEnd });
</script>

<template>
  <section class="ticket-admin">
    <header class="ticket-admin-head">
      <AppIcon name="message" :size="16" /><strong>{{ t('ticket.conversation') }}</strong>
      <span class="spacer"></span>
      <button v-if="response.followUpUrl" type="button" class="text-button small" @click="copyFollowUp"><AppIcon name="link" :size="14" />{{ t('ticket.copyRespondentLink') }}</button>
    </header>
    <p class="muted small">{{ response.ticket ? t('ticket.adminHint') : t('ticket.emailOnlyHint') }}</p>
    <div ref="thread" class="ticket-thread compact">
      <p v-if="!response.messages.length" class="muted small">{{ t('ticket.adminEmpty') }}</p>
      <template v-for="message in response.messages" :key="message.id">
        <div v-if="message.author === 'system'" class="timeline-event">
          <span>{{ t('ticket.statusEvent', { status: t(statusKeys[statusOf(message)] || 'status.pending') }) }}</span>
          <time :datetime="message.createdAt">{{ formatDate(message.createdAt) }}</time>
          <span v-if="message.delivery" class="delivery" :class="message.delivery">{{ t('ticket.delivery.' + message.delivery) }}</span>
          <button v-if="message.delivery === 'failed' && writable" type="button" class="text-button small" @click="resend(message)">{{ t('ticket.resend') }}</button>
        </div>
        <div v-else class="bubble" :class="message.author === 'staff' ? 'from-me' : 'from-staff'">
          <span class="bubble-author">{{ author(message) }}</span>
          <p class="preserve">{{ message.body }}</p>
          <span class="bubble-foot">
            <span v-if="message.delivery" class="delivery" :class="message.delivery"><AppIcon :name="message.delivery === 'failed' ? 'alert' : 'mail'" :size="12" />{{ t('ticket.delivery.' + message.delivery) }}</span>
            <button v-if="message.delivery === 'failed' && writable" type="button" class="text-button small" @click="resend(message)">{{ t('ticket.resend') }}</button>
            <time class="bubble-time" :datetime="message.createdAt">{{ formatDate(message.createdAt) }}</time>
          </span>
        </div>
      </template>
    </div>
    <form v-if="writable" class="ticket-composer" @submit.prevent="send">
      <textarea v-model="reply" class="input textarea autosize" rows="2" maxlength="5000" :placeholder="t('ticket.adminPlaceholder')" :aria-label="t('ticket.adminPlaceholder')" @keydown="keys"></textarea>
      <div class="ticket-composer-foot">
        <MenuButton v-if="messaging.templates.length" :label="t('ticket.templates')" icon="quote" :text="t('ticket.templates')" button-class="button ghost small" align="start">
          <button v-for="template in messaging.templates" :key="template.id" type="button" class="menu-item" @click="insert(template)"><span>{{ template.title }}<small class="clamp-1">{{ template.body }}</small></span></button>
        </MenuButton>
        <select v-model="replyStatus" class="input select compact" :aria-label="t('ticket.statusAfter')">
          <option value="">{{ t('ticket.keepStatus') }}</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ t('ticket.setStatus', { status: t(statusKeys[status]) }) }}</option>
        </select>
        <span class="spacer"></span>
        <label v-if="canEmail" class="check-row small" :title="response.contactEmail"><input v-model="sendEmail" type="checkbox" />{{ t('ticket.alsoEmail') }}</label>
        <button type="submit" class="button primary small" :disabled="sending || !reply.trim()"><AppIcon name="send" :size="14" />{{ sending ? t('form.submitting') : t('ticket.send') }}</button>
      </div>
    </form>
  </section>
</template>
