<script setup>
import { ref } from 'vue';
import { t, displayError } from '../i18n.js';
import { api, session } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import BrandMark from '../components/BrandMark.vue';
import SystemControls from '../components/SystemControls.vue';
import AppIcon from '../components/AppIcon.vue';
import { appVersion } from '../lib/version.js';

const username = ref(storage.get('quesuwa.lastUser') || ''), password = ref(''), remember = ref(false), busy = ref(false), error = ref(null), reveal = ref(false);
// Second step: the server returns a short-lived challenge after the password is accepted.
const challenge = ref(''), code = ref(''), useRecovery = ref(false);

async function login() {
  busy.value = true;
  error.value = null;
  try {
    const data = await api('/admin/login', { method: 'POST', body: { username: username.value.trim(), password: password.value, remember: remember.value } });
    storage.set('quesuwa.lastUser', username.value.trim());
    password.value = '';
    if (data.twoFactor) { challenge.value = data.challenge; code.value = ''; return; }
    session.user = data.user;
  } catch (reason) { error.value = reason; }
  finally { busy.value = false; }
}

async function verify() {
  busy.value = true;
  error.value = null;
  try {
    session.user = (await api('/admin/login/2fa', { method: 'POST', body: { challenge: challenge.value, code: code.value.trim() } })).user;
  } catch (reason) {
    error.value = reason;
    if (reason.code === 'errors.twoFactorExpired') challenge.value = '';
  } finally { busy.value = false; }
}

function back() { challenge.value = ''; code.value = ''; error.value = null; useRecovery.value = false; }
</script>

<template>
  <div class="login-screen">
    <header class="login-top"><BrandMark to="/" :subtitle="t('admin.subtitle')" /><SystemControls compact /></header>
    <main class="login-main">
      <form v-if="challenge" class="login-card" @submit.prevent="verify">
        <span class="login-badge"><AppIcon name="lock" :size="22" /></span>
        <h1>{{ t('twoFactor.loginTitle') }}</h1>
        <p class="muted">{{ useRecovery ? t('twoFactor.loginRecoveryIntro') : t('twoFactor.loginIntro') }}</p>
        <label class="field">
          <span class="field-label">{{ useRecovery ? t('twoFactor.recoveryCode') : t('twoFactor.code') }}</span>
          <input v-if="useRecovery" :key="'recovery'" v-model="code" class="input mono" name="recovery" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20" required autofocus />
          <input v-else :key="'totp'" v-model="code" class="input mono otp-input" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required autofocus />
        </label>
        <p v-if="error" class="form-error" role="alert"><AppIcon name="alert" :size="16" /><span>{{ displayError(error) }}</span></p>
        <button class="button primary block" type="submit" :disabled="busy || !code.trim()">{{ busy ? t('admin.loggingIn') : t('twoFactor.verify') }}</button>
        <div class="login-links">
          <button type="button" class="link-button" @click="useRecovery = !useRecovery; code = ''">{{ useRecovery ? t('twoFactor.useApp') : t('twoFactor.useRecovery') }}</button>
          <button type="button" class="link-button" @click="back">{{ t('common.back') }}</button>
        </div>
      </form>
      <form v-else class="login-card" method="post" action="/api/admin/login" @submit.prevent="login">
        <span class="login-badge"><AppIcon name="shield" :size="22" /></span>
        <h1>{{ t('admin.welcome') }}</h1>
        <p class="muted">{{ t('admin.loginIntro') }}</p>
        <label class="field">
          <span class="field-label">{{ t('admin.username') }}</span>
          <input v-model="username" class="input" name="username" autocomplete="username" required autocapitalize="off" spellcheck="false" :placeholder="t('admin.usernamePlaceholder')" :autofocus="!username" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('admin.password') }}</span>
          <span class="input-affix">
            <input v-model="password" class="input" name="password" :type="reveal ? 'text' : 'password'" autocomplete="current-password" required :placeholder="t('admin.passwordPlaceholder')" :autofocus="Boolean(username)" />
            <button type="button" class="icon-button ghost small" :aria-label="reveal ? t('admin.hidePassword') : t('admin.showPassword')" :aria-pressed="reveal" @click="reveal = !reveal"><AppIcon :name="reveal ? 'eyeOff' : 'eye'" :size="16" /></button>
          </span>
        </label>
        <label class="check-row"><input v-model="remember" type="checkbox" />{{ t('admin.remember') }}</label>
        <p v-if="error" class="form-error" role="alert"><AppIcon name="alert" :size="16" /><span>{{ displayError(error) }}</span></p>
        <button class="button primary block" type="submit" :disabled="busy || !password">{{ busy ? t('admin.loggingIn') : t('admin.login') }}</button>
        <p class="login-foot muted small">{{ t('admin.loginHint') }}</p>
        <span class="version-tag center">{{ t('app.versionLabel', { version: appVersion }) }}</span>
      </form>
    </main>
  </div>
</template>
