<script setup>
import { computed, onMounted, ref } from 'vue';
import { t } from '../../i18n.js';
import { api, allowed } from '../../lib/api.js';
import { notify, notifyError } from '../../lib/feedback.js';
import { toLocalInput, fromLocalInput, formatDate, formatNumber } from '../../lib/format.js';
import { accents, accentKeys, stateKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import ToggleSwitch from '../../components/ToggleSwitch.vue';
import { messaging, loadMessaging } from '../../lib/messaging.js';
import { linkHandler } from '../../lib/router.js';

const props = defineProps({ draft: Object, form: Object, readonly: Boolean });
const settings = computed(() => props.draft.settings);
const slugPrefix = '/f/';
const slugValid = computed(() => /^[a-z0-9][a-z0-9-]{1,63}$/.test(props.draft.slug));
const linkChanged = computed(() => props.form.state === 'published' && props.draft.slug !== props.form.slug);
const deliveries = ref([]), testing = ref(false), testResult = ref(null);
const webhookSaved = computed(() => Boolean(props.form.settings?.webhookUrl) && props.form.settings.webhookUrl === settings.value.webhookUrl);
const scheduleInvalid = computed(() => settings.value.startsAt && settings.value.endsAt && settings.value.startsAt >= settings.value.endsAt);

const randomToken = length => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return [...values].map(value => alphabet[value % alphabet.length]).join('');
};
const generateCode = () => { settings.value.accessCode = randomToken(6); };
const generateSecret = () => { settings.value.webhookSecret = randomToken(32).toLowerCase(); };
const normalizeSlug = () => { props.draft.slug = props.draft.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '').slice(0, 64); };

async function loadDeliveries() {
  if (!allowed('forms.write') || !props.form.settings?.webhookUrl) return;
  try { deliveries.value = await api('/admin/forms/' + props.form.id + '/webhook'); } catch { deliveries.value = []; }
}
async function testWebhook() {
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await api('/admin/forms/' + props.form.id + '/webhook/test', { method: 'POST', body: {} });
    notify(testResult.value.ok ? 'webhook.testOk' : 'webhook.testFailed', { type: testResult.value.ok ? 'success' : 'error', params: { status: testResult.value.status || '—' } });
    await loadDeliveries();
  } catch (error) { notifyError(error); }
  finally { testing.value = false; }
}
const emailFields = computed(() => props.draft.fields.filter(field => field.type === 'email'));
onMounted(() => { loadDeliveries(); loadMessaging(); });
</script>

<template>
  <div class="settings-layout">
    <section class="card settings-card">
      <header class="card-header"><h2><AppIcon name="play" :size="18" />{{ t('settings.publishTitle') }}</h2></header>
      <div class="state-picker" role="radiogroup" :aria-label="t('editor.state')">
        <label v-for="(key, state) in stateKeys" :key="state" class="state-option" :class="['state-' + state, { checked: draft.state === state }]">
          <input v-model="draft.state" type="radio" name="form-state" :value="state" :disabled="readonly" />
          <strong><span class="badge-dot"></span>{{ t(key) }}</strong>
          <small>{{ t('settings.stateHint.' + state) }}</small>
        </label>
      </div>
      <label class="field">
        <span class="field-label">{{ t('labels.slug') }}</span>
        <span class="input-affix prefix"><span class="affix-text">{{ slugPrefix }}</span><input v-model="draft.slug" class="input mono" maxlength="64" :disabled="readonly" :aria-invalid="!slugValid" @blur="normalizeSlug" /></span>
        <small v-if="!slugValid" class="field-error">{{ t('errors.slugInvalid') }}</small>
        <small v-else-if="linkChanged" class="field-warning">{{ t('settings.slugChanged') }}</small>
        <small v-else class="hint">{{ t('editor.slugHint') }}</small>
      </label>
      <ToggleSwitch v-model="settings.listed" :label="t('settings.listed')" :hint="t('settings.listedHint')" :disabled="readonly" />
    </section>

    <section class="card settings-card">
      <header class="card-header"><h2><AppIcon name="calendar" :size="18" />{{ t('settings.collection') }}</h2></header>
      <div class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('settings.startsAt') }}</span>
          <input class="input" type="datetime-local" :value="toLocalInput(settings.startsAt)" :disabled="readonly" @change="settings.startsAt = fromLocalInput($event.target.value)" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('settings.endsAt') }}</span>
          <input class="input" type="datetime-local" :value="toLocalInput(settings.endsAt)" :disabled="readonly" @change="settings.endsAt = fromLocalInput($event.target.value)" />
        </label>
      </div>
      <p v-if="scheduleInvalid" class="field-error small">{{ t('errors.scheduleInvalid') }}</p>
      <label class="field">
        <span class="field-label">{{ t('settings.responseLimit') }}</span>
        <input v-model.number="settings.responseLimit" class="input" type="number" min="0" max="1000000" :disabled="readonly" />
        <small class="hint">{{ t('settings.limitHint') }}</small>
      </label>
      <ToggleSwitch v-model="settings.onePerDevice" :label="t('settings.onePerDevice')" :hint="t('settings.onePerDeviceHint')" :disabled="readonly" />
      <label class="field">
        <span class="field-label">{{ t('settings.accessCode') }}</span>
        <span class="input-affix">
          <input v-model="settings.accessCode" class="input mono" maxlength="64" autocomplete="off" :disabled="readonly" :placeholder="t('settings.accessCodePlaceholder')" />
          <button v-if="!readonly" type="button" class="button ghost small" @click="generateCode"><AppIcon name="key" :size="14" />{{ t('settings.generate') }}</button>
        </span>
        <small class="hint">{{ t('settings.accessCodeHint') }}</small>
      </label>
      <label class="field">
        <span class="field-label">{{ t('settings.retention') }}</span>
        <select v-model.number="settings.retentionDays" class="input select" :disabled="readonly">
          <option :value="0">{{ t('settings.retentionForever') }}</option>
          <option v-for="days in [30, 90, 180, 365, 730]" :key="days" :value="days">{{ t('settings.retentionDays', { count: days }) }}</option>
          <option v-if="settings.retentionDays && ![30, 90, 180, 365, 730].includes(settings.retentionDays)" :value="settings.retentionDays">{{ t('settings.retentionDays', { count: settings.retentionDays }) }}</option>
        </select>
        <small class="hint" :class="{ 'field-error': settings.retentionDays > 0 }">{{ settings.retentionDays > 0 ? t('settings.retentionWarning', { count: settings.retentionDays }) : t('settings.retentionHint') }}</small>
      </label>
    </section>

    <section class="card settings-card">
      <header class="card-header"><h2><AppIcon name="sliders" :size="18" />{{ t('settings.experience') }}</h2></header>
      <div class="field">
        <span class="field-label">{{ t('settings.accent') }}</span>
        <div class="accent-picker" role="radiogroup" :aria-label="t('settings.accent')">
          <label v-for="accent in accents" :key="accent" class="accent-swatch" :class="['accent-' + accent, { checked: settings.accent === accent }]" :title="t(accentKeys[accent])">
            <input v-model="settings.accent" type="radio" name="form-accent" :value="accent" :disabled="readonly" :aria-label="t(accentKeys[accent])" />
            <span></span>
          </label>
        </div>
      </div>
      <ToggleSwitch v-model="settings.ticketMode" :label="t('settings.ticketMode')" :hint="t('settings.ticketModeHint')" :disabled="readonly" />
      <ToggleSwitch v-model="settings.showProgress" :label="t('settings.showProgress')" :disabled="readonly" />
      <ToggleSwitch v-model="settings.showNumbers" :label="t('settings.showNumbers')" :disabled="readonly" />
      <ToggleSwitch v-model="settings.saveProgress" :label="t('settings.saveProgress')" :hint="t('settings.saveProgressHint')" :disabled="readonly" />
      <label class="field">
        <span class="field-label">{{ t('settings.submitLabel') }}</span>
        <input v-model="settings.submitLabel" class="input" maxlength="60" :disabled="readonly" :placeholder="t('form.submit')" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('settings.consent') }}</span>
        <textarea v-model="settings.consentText" class="input textarea autosize" rows="3" maxlength="2000" :disabled="readonly" :placeholder="t('settings.consentHint')"></textarea>
      </label>
    </section>

    <section class="card settings-card">
      <header class="card-header"><h2><AppIcon name="message" :size="18" />{{ t('settings.messages') }}</h2></header>
      <label class="field">
        <span class="field-label">{{ t('labels.thanks') }}</span>
        <textarea v-model="draft.thanks" class="input textarea autosize" rows="2" maxlength="1000" :disabled="readonly" :placeholder="t('common.thanks')"></textarea>
      </label>
      <label class="field">
        <span class="field-label">{{ t('settings.closedMessage') }}</span>
        <textarea v-model="settings.closedMessage" class="input textarea autosize" rows="2" maxlength="1000" :disabled="readonly" :placeholder="t('settings.closedMessagePlaceholder')"></textarea>
      </label>
    </section>

    <section class="card settings-card span-2">
      <header class="card-header"><h2><AppIcon name="mail" :size="18" />{{ t('formNotify.title') }}</h2></header>
      <div class="inline-fields notify-grid">
        <div class="stack-form">
          <ToggleSwitch v-model="settings.notifyAdmins" :label="t('formNotify.admins')" :hint="t('formNotify.adminsHint')" :disabled="readonly" />
          <p v-if="messaging.loaded && !messaging.alerts" class="hint small"><AppIcon name="info" :size="14" /><span>{{ t('formNotify.noAlerts') }} <a v-if="allowed('system.read')" href="/admin/notifications" @click="linkHandler('/admin/notifications')($event)">{{ t('formNotify.configure') }}</a></span></p>
        </div>
        <div class="stack-form">
          <label class="field">
            <span class="field-label">{{ t('formNotify.contactField') }}</span>
            <select v-model="settings.contactField" class="input select" :disabled="readonly">
              <option value="">{{ t('formNotify.contactAuto') }}</option>
              <option v-for="field in emailFields" :key="field.id" :value="field.id">{{ field.label }}</option>
              <option value="none">{{ t('formNotify.contactNone') }}</option>
            </select>
            <small class="hint">{{ emailFields.length ? t('formNotify.contactHint') : t('formNotify.contactMissing') }}</small>
          </label>
          <ToggleSwitch v-model="settings.sendReceipt" :label="t('formNotify.receipt')" :hint="t('formNotify.receiptHint')" :disabled="readonly || settings.contactField === 'none'" />
          <p v-if="messaging.loaded && !messaging.mail" class="hint small"><AppIcon name="info" :size="14" /><span>{{ t('formNotify.noMail') }} <a v-if="allowed('system.read')" href="/admin/notifications" @click="linkHandler('/admin/notifications')($event)">{{ t('formNotify.configure') }}</a></span></p>
        </div>
      </div>
    </section>

    <section class="card settings-card span-2">
      <header class="card-header"><h2><AppIcon name="zap" :size="18" />{{ t('webhook.title') }}</h2></header>
      <p class="muted small">{{ t('webhook.intro') }}</p>
      <div class="inline-fields">
        <label class="field grow">
          <span class="field-label">{{ t('webhook.url') }}</span>
          <input v-model="settings.webhookUrl" class="input mono" type="url" maxlength="500" :disabled="readonly" :placeholder="t('webhook.urlPlaceholder')" />
        </label>
        <label class="field grow">
          <span class="field-label">{{ t('webhook.secret') }}</span>
          <span class="input-affix">
            <input v-model="settings.webhookSecret" class="input mono" maxlength="128" autocomplete="off" :disabled="readonly" :placeholder="t('webhook.secretPlaceholder')" />
            <button v-if="!readonly" type="button" class="button ghost small" @click="generateSecret"><AppIcon name="key" :size="14" />{{ t('settings.generate') }}</button>
          </span>
        </label>
      </div>
      <small class="hint">{{ t('webhook.signatureHint') }}</small>
      <div v-if="allowed('forms.write')" class="webhook-test">
        <button type="button" class="button small" :disabled="testing || !webhookSaved" @click="testWebhook"><AppIcon name="send" :size="14" />{{ testing ? t('common.loading') : t('webhook.test') }}</button>
        <span v-if="!webhookSaved && settings.webhookUrl" class="muted small">{{ t('webhook.saveFirst') }}</span>
      </div>
      <div v-if="deliveries.length" class="table-scroll">
        <table class="data-table compact">
          <thead><tr><th>{{ t('webhook.time') }}</th><th>{{ t('webhook.event') }}</th><th>{{ t('webhook.status') }}</th><th>{{ t('webhook.duration') }}</th></tr></thead>
          <tbody>
            <tr v-for="(delivery, index) in deliveries" :key="index">
              <td>{{ formatDate(delivery.createdAt) }}</td>
              <td class="mono">{{ delivery.event }}</td>
              <td><span class="badge" :class="delivery.ok ? 'success' : 'danger'">{{ delivery.status || delivery.error || '—' }}</span></td>
              <td>{{ t('time.ms', { value: formatNumber(delivery.durationMs) }) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
