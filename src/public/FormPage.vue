<script setup>
import { computed, onMounted, ref } from 'vue';
import { t, displayError } from '../i18n.js';
import { api } from '../lib/api.js';
import { linkHandler } from '../lib/router.js';
import { formatDate, shortId } from '../lib/format.js';
import { copyText } from '../lib/clipboard.js';
import { notify } from '../lib/feedback.js';
import AppIcon from '../components/AppIcon.vue';
import QuestionnaireForm from './QuestionnaireForm.vue';
import { rememberTicket, ticketLink } from '../lib/tickets.js';

const props = defineProps({ slug: { type: String, required: true } });
const state = ref('loading'), form = ref(null), locked = ref(null), error = ref(null), success = ref(null);
const accessCode = ref(''), accessError = ref(null), unlocking = ref(false), attempt = ref(0);

const accent = computed(() => form.value?.settings?.accent || locked.value?.settings?.accent || 'coral');
const errorIcon = computed(() => ({ 'errors.alreadySubmitted': 'checkCircle', 'errors.notStarted': 'clock', 'errors.formClosed': 'archive', 'errors.outsideSchedule': 'clock', 'errors.responseLimit': 'archive' })[error.value?.code] || 'alert');

async function load() {
  state.value = 'loading';
  try {
    const data = await api('/forms/' + encodeURIComponent(props.slug));
    if (data.locked) { locked.value = data; state.value = 'locked'; }
    else { form.value = data; state.value = 'form'; }
    document.title = (data.title || t('common.untitled')) + ' · ' + t('app.brand');
  } catch (reason) {
    error.value = reason;
    state.value = 'error';
  }
}

async function unlock() {
  if (!accessCode.value.trim()) return;
  unlocking.value = true;
  accessError.value = null;
  try {
    form.value = await api('/forms/' + encodeURIComponent(props.slug) + '/access', { method: 'POST', body: { accessCode: accessCode.value.trim() } });
    state.value = 'form';
  } catch (reason) {
    if (reason.code === 'errors.accessCode' || reason.code === 'errors.rateLimit') accessError.value = reason;
    else { error.value = reason; state.value = 'error'; }
  } finally { unlocking.value = false; }
}

function submitted(data) {
  success.value = data;
  if (data.ticket) rememberTicket({ id: data.ticket.id, key: data.ticket.key, title: form.value.title });
  state.value = 'success';
  window.scrollTo({ top: 0 });
}

function again() {
  success.value = null;
  attempt.value++;
  state.value = 'form';
}

const followUp = computed(() => success.value?.ticket ? ticketLink(success.value.ticket.id, success.value.ticket.key) : '');
const followUpPath = computed(() => followUp.value ? followUp.value.slice(window.location.origin.length) : '');
async function copyFollowUp() {
  if (await copyText(followUp.value)) notify('ticket.linkCopied');
}

async function copyReceipt() {
  if (await copyText(shortId(success.value.id))) notify('public.receiptCopied');
}

onMounted(load);
</script>

<template>
  <div class="form-page" :class="'accent-' + accent">
    <div v-if="state === 'loading'" class="state-panel" aria-busy="true">
      <span class="spinner"></span>
      <p>{{ t('public.loading') }}</p>
    </div>

    <div v-else-if="state === 'error'" class="state-panel">
      <span class="state-icon"><AppIcon :name="errorIcon" :size="28" /></span>
      <h1>{{ error.code === 'errors.alreadySubmitted' ? t('public.thankYou') : t('public.unavailable') }}</h1>
      <p>{{ displayError(error) }}</p>
      <p v-if="error.params?.startsAt" class="muted">{{ t('public.opensAt', { date: formatDate(error.params.startsAt) }) }}</p>
      <p v-if="error.params?.message" class="custom-message preserve">{{ error.params.message }}</p>
      <div class="state-actions">
        <a class="button primary" href="/" @click="linkHandler('/')($event)">{{ t('public.backHome') }}</a>
        <button v-if="error.code === 'errors.network' || error.status >= 500" type="button" class="button" @click="load"><AppIcon name="refresh" :size="16" />{{ t('common.retry') }}</button>
      </div>
    </div>

    <form v-else-if="state === 'locked'" class="state-panel access-gate" @submit.prevent="unlock">
      <span class="state-icon"><AppIcon name="lock" :size="28" /></span>
      <h1>{{ locked.title }}</h1>
      <p>{{ t('public.accessIntro') }}</p>
      <label class="field">
        <span class="field-label">{{ t('public.accessCode') }}</span>
        <input v-model="accessCode" class="input" type="password" autocomplete="off" autofocus maxlength="64" :aria-invalid="Boolean(accessError)" />
      </label>
      <p v-if="accessError" class="field-error" role="alert">{{ displayError(accessError) }}</p>
      <button class="button primary block" type="submit" :disabled="unlocking || !accessCode.trim()">{{ unlocking ? t('common.loading') : t('public.unlock') }}</button>
    </form>

    <div v-else-if="state === 'success'" class="state-panel success-panel" role="status">
      <span class="state-icon success"><AppIcon name="check" :size="30" /></span>
      <span class="eyebrow">{{ t('public.delivered') }}</span>
      <h1>{{ t('public.thankYou') }}</h1>
      <p class="preserve">{{ success.thanksKey ? t(success.thanksKey) : success.thanks }}</p>
      <div class="receipt">
        <span>{{ t('public.receipt') }}</span>
        <strong class="mono">{{ shortId(success.id) }}</strong>
        <button type="button" class="icon-button ghost small" :aria-label="t('common.copy')" @click="copyReceipt"><AppIcon name="copy" :size="16" /></button>
      </div>
      <small v-if="!followUp" class="muted">{{ t('public.receiptHint') }}</small>
      <div v-else class="follow-up">
        <strong><AppIcon name="message" :size="16" />{{ t('ticket.followTitle') }}</strong>
        <p>{{ t('ticket.followHint') }}</p>
        <div class="share-url">
          <input class="input mono" :value="followUp" readonly :aria-label="t('ticket.linkLabel')" @focus="$event.target.select()" />
          <button type="button" class="button" @click="copyFollowUp"><AppIcon name="copy" :size="16" />{{ t('common.copy') }}</button>
        </div>
        <a class="button primary" :href="followUpPath" @click="linkHandler(followUpPath)($event)"><AppIcon name="arrowRight" :size="16" />{{ t('ticket.openTicket') }}</a>
      </div>
      <div class="state-actions">
        <a class="button" href="/" @click="linkHandler('/')($event)">{{ t('public.backHome') }}</a>
        <button v-if="!form.settings.onePerDevice" type="button" class="button primary" @click="again">{{ t('public.again') }}</button>
      </div>
    </div>

    <QuestionnaireForm v-else :key="attempt" :form="form" :access-code="accessCode.trim()" @submitted="submitted" @expired="load" />
  </div>
</template>
