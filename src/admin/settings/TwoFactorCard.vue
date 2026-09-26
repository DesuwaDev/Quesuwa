<script setup>
import { ref } from 'vue';
import QRCode from 'qrcode';
import { t } from '../../i18n.js';
import { api, session } from '../../lib/api.js';
import { notify, notifyError, promptDialog } from '../../lib/feedback.js';
import { copyText } from '../../lib/clipboard.js';
import AppIcon from '../../components/AppIcon.vue';

defineProps({ recoveryLeft: { type: Number, default: 0 } });
const emit = defineEmits(['changed']);
const setup = ref(null), code = ref(''), codes = ref([]), busy = ref(false);

async function start() {
  busy.value = true;
  try {
    const data = await api('/admin/2fa/setup', { method: 'POST', body: {} });
    const svg = await QRCode.toString(data.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    setup.value = { ...data, svg, grouped: data.secret.match(/.{1,4}/g).join(' ') };
    code.value = '';
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}

async function enable() {
  busy.value = true;
  try {
    const data = await api('/admin/2fa/enable', { method: 'POST', body: { code: code.value.replace(/\s/g, '') } });
    session.user = data.user;
    codes.value = data.recoveryCodes;
    setup.value = null;
    notify('twoFactor.enabledToast');
    emit('changed');
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}

const askPassword = (titleKey, messageKey, danger = false) => promptDialog({ titleKey, messageKey, confirmKey: titleKey, fieldKey: 'account.currentPassword', inputType: 'password', required: true, danger });

async function regenerate() {
  const password = await askPassword('twoFactor.regenerate', 'twoFactor.regenerateConfirm');
  if (password === null) return;
  try {
    codes.value = (await api('/admin/2fa/recovery', { method: 'POST', body: { password } })).recoveryCodes;
    emit('changed');
  } catch (error) { notifyError(error); }
}

async function disable() {
  const password = await askPassword('twoFactor.disable', 'twoFactor.disableConfirm', true);
  if (password === null) return;
  try {
    session.user = (await api('/admin/2fa/disable', { method: 'POST', body: { password } })).user;
    codes.value = [];
    notify('twoFactor.disabledToast');
    emit('changed');
  } catch (error) { notifyError(error); }
}

async function copyCodes() {
  if (await copyText(codes.value.join('\n'))) notify('share.copied');
}
function downloadCodes() {
  const blob = new Blob([codes.value.join('\n') + '\n'], { type: 'text/plain' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `quesuwa-recovery-${session.user.username}.txt` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function copySecret() {
  if (await copyText(setup.value.secret)) notify('share.copied');
}
</script>

<template>
  <section class="card settings-card">
    <header class="card-header">
      <h2><AppIcon name="lock" :size="18" />{{ t('twoFactor.title') }}</h2>
      <span class="badge" :class="session.user.twoFactor ? 'success' : 'muted'">{{ session.user.twoFactor ? t('twoFactor.on') : t('twoFactor.off') }}</span>
    </header>
    <p class="muted small">{{ t('twoFactor.intro') }}</p>

    <div v-if="codes.length" class="recovery-box">
      <p class="banner warning"><AppIcon name="alert" :size="16" /><span>{{ t('twoFactor.codesIntro') }}</span></p>
      <ol class="recovery-codes mono">
        <li v-for="item in codes" :key="item">{{ item }}</li>
      </ol>
      <div class="button-row">
        <button type="button" class="button small" @click="copyCodes"><AppIcon name="copy" :size="14" />{{ t('common.copy') }}</button>
        <button type="button" class="button small" @click="downloadCodes"><AppIcon name="download" :size="14" />{{ t('common.download') }}</button>
        <button type="button" class="button primary small" @click="codes = []">{{ t('twoFactor.savedCodes') }}</button>
      </div>
    </div>

    <template v-else-if="session.user.twoFactor">
      <p class="small">{{ t('twoFactor.recoveryLeft', { count: recoveryLeft }) }}</p>
      <div class="button-row">
        <button type="button" class="button small" @click="regenerate"><AppIcon name="refresh" :size="14" />{{ t('twoFactor.regenerate') }}</button>
        <button type="button" class="button ghost small danger-text" @click="disable">{{ t('twoFactor.disable') }}</button>
      </div>
    </template>

    <form v-else-if="setup" class="totp-setup" @submit.prevent="enable">
      <div class="totp-qr" role="img" :aria-label="t('twoFactor.qrLabel')" v-html="setup.svg"></div>
      <div class="totp-steps">
        <p><strong>1.</strong> {{ t('twoFactor.step1') }}</p>
        <p class="small muted">{{ t('twoFactor.manual') }}</p>
        <span class="input-affix">
          <code class="secret-code mono">{{ setup.grouped }}</code>
          <button type="button" class="icon-button ghost small" :aria-label="t('common.copy')" @click="copySecret"><AppIcon name="copy" :size="14" /></button>
        </span>
        <label class="field">
          <span class="field-label"><strong>2.</strong> {{ t('twoFactor.step2') }}</span>
          <input v-model="code" class="input mono otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus />
        </label>
        <div class="button-row">
          <button type="submit" class="button primary small" :disabled="busy || code.replace(/\s/g, '').length !== 6">{{ t('twoFactor.enable') }}</button>
          <button type="button" class="button ghost small" @click="setup = null">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </form>

    <div v-else class="button-row">
      <button type="button" class="button primary small" :disabled="busy" @click="start"><AppIcon name="shield" :size="14" />{{ t('twoFactor.start') }}</button>
    </div>
  </section>
</template>
