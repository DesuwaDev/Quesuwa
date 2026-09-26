<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n.js';
import { api } from '../../lib/api.js';
import { notify, notifyError, confirmDialog } from '../../lib/feedback.js';
import { formatDate } from '../../lib/format.js';
import { loadMessaging } from '../../lib/messaging.js';
import { addLeaveGuard, route } from '../../lib/router.js';
import AppIcon from '../../components/AppIcon.vue';
import ToggleSwitch from '../../components/ToggleSwitch.vue';
import EmptyState from '../../components/EmptyState.vue';
import SmtpFields from './SmtpFields.vue';

const form = ref(null), baseline = ref(''), log = ref([]), saving = ref(false), testing = ref(''), testTo = ref('');
const previewKind = ref('reply'), previewHtml = ref(''), previewError = ref(false);
const previewKinds = [['alert', 'notifyCenter.previewAlert'], ['receipt', 'notifyCenter.previewReceipt'], ['reply', 'notifyCenter.previewReply']];
const dirty = computed(() => Boolean(form.value) && JSON.stringify(form.value) !== baseline.value);

function adopt(config) {
  const profile = value => ({ ...value, pass: '', clearPass: false });
  form.value = {
    siteUrl: config.siteUrl,
    events: { ...config.events },
    alertMail: profile(config.alertMail),
    mail: profile(config.mail),
    telegram: { ...config.telegram, token: '', clearToken: false, chatIdsText: config.telegram.chatIds.join('\n') },
    digest: { ...config.digest },
    appearance: { ...config.appearance },
    templates: config.templates.map(item => ({ ...item }))
  };
  baseline.value = JSON.stringify(form.value);
}

async function load() {
  try {
    const data = await api('/admin/notifications');
    adopt(data.config);
    log.value = data.log;
  } catch (error) { notifyError(error); }
}

function payload() {
  const value = form.value;
  const { chatIdsText, ...telegram } = value.telegram;
  return {
    siteUrl: value.siteUrl,
    events: value.events,
    alertMail: value.alertMail,
    mail: value.mail,
    telegram: { ...telegram, chatIds: chatIdsText.split(/[\s,;，；]+/).map(item => item.trim()).filter(Boolean) },
    digest: value.digest,
    appearance: value.appearance,
    templates: value.templates.filter(item => item.title.trim() || item.body.trim())
  };
}

async function save() {
  saving.value = true;
  try {
    const data = await api('/admin/notifications', { method: 'PUT', body: payload() });
    adopt(data.config);
    log.value = data.log;
    loadMessaging(true);
    notify('notifyCenter.saved');
  } catch (error) { notifyError(error); }
  finally { saving.value = false; }
}

async function test(channel) {
  testing.value = channel;
  try {
    const data = await api('/admin/notifications/test', { method: 'POST', body: { channel, to: testTo.value } });
    log.value = data.log;
    if (data.ok) notify('notifyCenter.testOk');
    else notify('notifyCenter.testFailed', { type: 'error', params: { error: data.error || '—' }, timeout: 9000 });
  } catch (error) { notifyError(error); }
  finally { testing.value = ''; }
}

async function retry(entry) {
  try {
    log.value = (await api(`/admin/notifications/outbox/${entry.id}/retry`, { method: 'POST', body: {} })).log;
    notify('notifyCenter.retryQueued');
  } catch (error) { notifyError(error); }
}

// The preview is rendered by the server with the unsaved appearance so it matches real mail exactly.
let previewTimer = null;
async function renderPreview() {
  if (!form.value) return;
  try {
    previewHtml.value = (await api('/admin/notifications/preview', { method: 'POST', body: { kind: previewKind.value, appearance: form.value.appearance } })).html;
    previewError.value = false;
  } catch { previewError.value = true; }
}
watch(() => form.value && [previewKind.value, JSON.stringify(form.value.appearance)], () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 350);
});
onBeforeUnmount(() => clearTimeout(previewTimer));
const colorValid = computed(() => /^#[0-9a-fA-F]{6}$/.test(form.value?.appearance.color || ''));

const useCurrentSite = () => { form.value.siteUrl = window.location.origin; };
const addTemplate = () => form.value.templates.push({ id: '', title: '', body: '' });
const removeTemplate = index => form.value.templates.splice(index, 1);
const channelKey = channel => ({ alertMail: 'notifyCenter.channelAlert', telegram: 'notifyCenter.channelTelegram', mail: 'notifyCenter.channelMail' })[channel] || 'notifyCenter.channelMail';
const eventKey = event => ({ 'response.created': 'notifyCenter.eventNew', 'message.created': 'notifyCenter.eventReply', receipt: 'notifyCenter.eventReceipt', 'message.staff': 'notifyCenter.eventStaff', 'status.changed': 'notifyCenter.eventStatus', digest: 'notifyCenter.eventDigest', test: 'notifyCenter.eventTest' })[event] || 'notifyCenter.eventTest';
const statusClass = entry => ({ sent: 'success', pending: 'warning', failed: 'danger' })[entry.status] || 'muted';
const statusLabel = entry => entry.status === 'sent' ? t('notifyCenter.ok') : entry.status === 'pending' ? (entry.attempts ? t('notifyCenter.retrying', { count: entry.attempts }) : t('notifyCenter.queued')) : t('notifyCenter.failed');

const guard = async target => {
  if (!dirty.value || target === route.path) return true;
  return confirmDialog({ titleKey: 'workspace.leaveTitle', messageKey: 'workspace.leave', confirmKey: 'workspace.discard', danger: true });
};
guard.dirty = () => dirty.value;
const removeGuard = addLeaveGuard(guard);
onBeforeUnmount(removeGuard);
onMounted(load);
</script>

<template>
  <div class="page narrow">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ t('nav.notifications') }}</span>
        <h1>{{ t('notifyCenter.heading') }}</h1>
        <p class="muted">{{ t('notifyCenter.intro') }}</p>
      </div>
      <div class="page-actions"><button type="button" class="button primary" :disabled="!dirty || saving" @click="save"><AppIcon name="check" :size="16" />{{ saving ? t('editor.saving') : t('common.save') }}</button></div>
    </header>

    <template v-if="form">
      <section class="card settings-card">
        <header class="card-header"><h2><AppIcon name="globe" :size="18" />{{ t('notifyCenter.site') }}</h2></header>
        <label class="field">
          <span class="field-label">{{ t('notifyCenter.siteUrl') }}</span>
          <span class="input-affix">
            <input v-model.trim="form.siteUrl" class="input mono" type="url" :placeholder="t('notifyCenter.siteUrlPlaceholder')" />
            <button type="button" class="button ghost small" @click="useCurrentSite">{{ t('notifyCenter.useCurrent') }}</button>
          </span>
          <small class="hint">{{ t('notifyCenter.siteUrlHint') }}</small>
        </label>
      </section>

      <section class="card settings-card">
        <header class="card-header"><h2><AppIcon name="inbox" :size="18" />{{ t('notifyCenter.alerts') }}</h2></header>
        <p class="muted small">{{ t('notifyCenter.alertsIntro') }}</p>
        <div class="check-group">
          <label class="check-row"><input v-model="form.events.newResponse" type="checkbox" />{{ t('notifyCenter.eventNew') }}</label>
          <label class="check-row"><input v-model="form.events.ticketReply" type="checkbox" />{{ t('notifyCenter.eventReply') }}</label>
        </div>
        <h3 class="subheading"><AppIcon name="mail" :size="16" />{{ t('notifyCenter.channelAlert') }}</h3>
        <SmtpFields :profile="form.alertMail" kind="alert" />
        <div><button type="button" class="button small" :disabled="dirty || testing === 'alertMail'" @click="test('alertMail')"><AppIcon name="send" :size="14" />{{ testing === 'alertMail' ? t('common.loading') : t('notifyCenter.test') }}</button> <span v-if="dirty" class="muted small">{{ t('webhook.saveFirst') }}</span></div>

        <h3 class="subheading"><AppIcon name="send" :size="16" />{{ t('notifyCenter.channelTelegram') }}</h3>
        <ToggleSwitch v-model="form.telegram.enabled" :label="t('notifyCenter.enable')" />
        <div class="inline-fields">
          <label class="field">
            <span class="field-label">{{ t('notifyCenter.token') }}</span>
            <span class="input-affix">
              <input v-model.trim="form.telegram.token" class="input mono" type="password" autocomplete="off" :placeholder="form.telegram.hasToken && !form.telegram.clearToken ? t('notifyCenter.passKept') : t('notifyCenter.tokenPlaceholder')" @input="form.telegram.clearToken = false" />
              <button v-if="form.telegram.hasToken && !form.telegram.clearToken" type="button" class="button ghost small" @click="form.telegram.clearToken = true; form.telegram.token = ''">{{ t('notifyCenter.clear') }}</button>
            </span>
          </label>
          <label class="field">
            <span class="field-label">{{ t('notifyCenter.chatIds') }}</span>
            <textarea v-model="form.telegram.chatIdsText" class="input textarea mono" rows="1" :placeholder="t('notifyCenter.chatIdsPlaceholder')"></textarea>
          </label>
        </div>
        <label class="field">
          <span class="field-label">{{ t('notifyCenter.apiBase') }}</span>
          <input v-model.trim="form.telegram.apiBase" class="input mono" type="url" />
          <small class="hint">{{ t('notifyCenter.apiBaseHint') }}</small>
        </label>
        <p class="hint small"><AppIcon name="info" :size="14" />{{ t('notifyCenter.telegramHint') }}</p>
        <div><button type="button" class="button small" :disabled="dirty || testing === 'telegram'" @click="test('telegram')"><AppIcon name="send" :size="14" />{{ testing === 'telegram' ? t('common.loading') : t('notifyCenter.test') }}</button></div>
      </section>

      <section class="card settings-card">
        <header class="card-header"><h2><AppIcon name="mail" :size="18" />{{ t('notifyCenter.respondents') }}</h2></header>
        <p class="muted small">{{ t('notifyCenter.respondentsIntro') }}</p>
        <SmtpFields :profile="form.mail" kind="mail" />
        <div class="inline-form">
          <label class="field grow">
            <span class="field-label">{{ t('notifyCenter.testTo') }}</span>
            <input v-model.trim="testTo" class="input" type="email" :placeholder="t('form.emailPlaceholder')" />
          </label>
          <button type="button" class="button small" :disabled="dirty || !testTo || testing === 'mail'" @click="test('mail')"><AppIcon name="send" :size="14" />{{ testing === 'mail' ? t('common.loading') : t('notifyCenter.test') }}</button>
        </div>
      </section>

      <section class="card settings-card">
        <header class="card-header"><h2><AppIcon name="calendar" :size="18" />{{ t('notifyCenter.digest') }}</h2></header>
        <p class="muted small">{{ t('notifyCenter.digestIntro') }}</p>
        <ToggleSwitch v-model="form.digest.enabled" :label="t('notifyCenter.digestEnable')" :hint="form.alertMail.enabled ? '' : t('notifyCenter.digestNeedsSmtp')" />
        <div class="inline-fields">
          <label class="field">
            <span class="field-label">{{ t('notifyCenter.digestHour') }}</span>
            <select v-model.number="form.digest.hour" class="input select" :disabled="!form.digest.enabled">
              <option v-for="hour in 24" :key="hour" :value="hour - 1">{{ String(hour - 1).padStart(2, '0') }}:00</option>
            </select>
          </label>
        </div>
        <ToggleSwitch v-model="form.digest.onlyActive" :label="t('notifyCenter.digestOnlyActive')" :disabled="!form.digest.enabled" />
        <ToggleSwitch v-model="form.digest.toRecipients" :label="t('notifyCenter.digestToRecipients')" :hint="t('notifyCenter.digestMembersHint')" :disabled="!form.digest.enabled" />
        <div><button type="button" class="button small" :disabled="dirty || testing === 'digest'" @click="test('digest')"><AppIcon name="send" :size="14" />{{ testing === 'digest' ? t('common.loading') : t('notifyCenter.digestTest') }}</button></div>
      </section>

      <section class="card settings-card">
        <header class="card-header"><h2><AppIcon name="image" :size="18" />{{ t('notifyCenter.appearance') }}</h2></header>
        <p class="muted small">{{ t('notifyCenter.appearanceIntro') }}</p>
        <div class="appearance-layout">
          <div class="stack-form">
            <div class="inline-fields">
              <label class="field">
                <span class="field-label">{{ t('notifyCenter.brandName') }}</span>
                <input v-model="form.appearance.brandName" class="input" maxlength="60" :placeholder="t('notifyCenter.brandPlaceholder')" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('notifyCenter.color') }}</span>
                <span class="input-affix">
                  <input v-model="form.appearance.color" class="color-input" type="color" :aria-label="t('notifyCenter.color')" />
                  <input v-model.trim="form.appearance.color" class="input mono" maxlength="7" :aria-invalid="!colorValid" />
                </span>
              </label>
            </div>
            <label class="field">
              <span class="field-label">{{ t('notifyCenter.logoUrl') }}</span>
              <input v-model.trim="form.appearance.logoUrl" class="input mono" type="url" maxlength="500" :placeholder="t('notifyCenter.logoPlaceholder')" />
              <small class="hint">{{ t('notifyCenter.logoHint') }}</small>
            </label>
            <label class="field">
              <span class="field-label">{{ t('notifyCenter.signature') }}</span>
              <textarea v-model="form.appearance.signature" class="input textarea" rows="2" maxlength="500" :placeholder="t('notifyCenter.signaturePlaceholder')"></textarea>
              <small class="hint">{{ t('notifyCenter.signatureHint') }}</small>
            </label>
            <label class="field">
              <span class="field-label">{{ t('notifyCenter.footer') }}</span>
              <textarea v-model="form.appearance.footer" class="input textarea" rows="2" maxlength="500" :placeholder="t('notifyCenter.footerPlaceholder')"></textarea>
            </label>
          </div>
          <div class="mail-preview">
            <div class="segmented" role="tablist">
              <button v-for="[kind, key] in previewKinds" :key="kind" type="button" role="tab" :aria-selected="previewKind === kind" :class="{ active: previewKind === kind }" @click="previewKind = kind">{{ t(key) }}</button>
            </div>
            <iframe v-if="previewHtml" class="mail-frame" :title="t('notifyCenter.preview')" sandbox="" :srcdoc="previewHtml"></iframe>
            <p v-if="previewError" class="field-error small">{{ t('notifyCenter.previewInvalid') }}</p>
          </div>
        </div>
      </section>

      <section class="card settings-card">
        <header class="card-header"><h2><AppIcon name="quote" :size="18" />{{ t('notifyCenter.templates') }}</h2><button type="button" class="button small" :disabled="form.templates.length >= 50" @click="addTemplate"><AppIcon name="plus" :size="14" />{{ t('notifyCenter.addTemplate') }}</button></header>
        <p class="muted small">{{ t('notifyCenter.templatesIntro') }}</p>
        <p v-if="!form.templates.length" class="hint small">{{ t('notifyCenter.templatesEmpty') }}</p>
        <div v-for="(template, index) in form.templates" :key="index" class="template-row">
          <input v-model="template.title" class="input" maxlength="60" :placeholder="t('notifyCenter.templateTitle')" :aria-label="t('notifyCenter.templateTitle')" />
          <textarea v-model="template.body" class="input textarea autosize" rows="2" maxlength="5000" :placeholder="t('notifyCenter.templateBody')" :aria-label="t('notifyCenter.templateBody')"></textarea>
          <button type="button" class="icon-button ghost small danger" :aria-label="t('common.delete')" @click="removeTemplate(index)"><AppIcon name="trash" :size="14" /></button>
        </div>
      </section>

      <section class="card flush">
        <header class="card-header padded"><h2><AppIcon name="activity" :size="18" />{{ t('notifyCenter.log') }}</h2><span class="muted small hide-narrow">{{ t('notifyCenter.logHint') }}</span><button type="button" class="button ghost small" @click="load"><AppIcon name="refresh" :size="14" />{{ t('common.refresh') }}</button></header>
        <EmptyState v-if="!log.length" icon="send" :text="t('notifyCenter.logEmpty')" compact />
        <div v-else class="table-scroll">
          <table class="data-table compact">
            <thead><tr><th>{{ t('system.time') }}</th><th>{{ t('notifyCenter.channel') }}</th><th>{{ t('webhook.event') }}</th><th>{{ t('notifyCenter.target') }}</th><th>{{ t('webhook.status') }}</th></tr></thead>
            <tbody>
              <tr v-for="entry in log" :key="entry.id">
                <td class="nowrap">{{ formatDate(entry.createdAt) }}</td>
                <td>{{ t(channelKey(entry.channel)) }}</td>
                <td>{{ t(eventKey(entry.event)) }}</td>
                <td class="mono"><span class="clamp-1">{{ entry.target }}</span></td>
                <td>
                  <span class="badge" :class="statusClass(entry)" :title="entry.error">{{ statusLabel(entry) }}</span>
                  <button v-if="entry.status === 'failed'" type="button" class="button ghost small" @click="retry(entry)"><AppIcon name="refresh" :size="12" />{{ t('notifyCenter.retry') }}</button>
                  <small v-if="entry.error" class="log-error">{{ entry.error }}</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <div v-if="dirty" class="save-dock visible">
      <span>{{ t('editor.unsaved') }}</span>
      <button type="button" class="button primary small" :disabled="saving" @click="save">{{ saving ? t('editor.saving') : t('common.save') }}</button>
    </div>
  </div>
</template>
