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

async function login() {
  busy.value = true;
  error.value = null;
  try {
    const data = await api('/admin/login', { method: 'POST', body: { username: username.value.trim(), password: password.value, remember: remember.value } });
    storage.set('quesuwa.lastUser', username.value.trim());
    password.value = '';
    session.user = data.user;
  } catch (reason) { error.value = reason; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="login-screen">
    <header class="login-top"><BrandMark to="/" :subtitle="t('admin.subtitle')" /><SystemControls compact /></header>
    <main class="login-main">
      <form class="login-card" method="post" action="/api/admin/login" @submit.prevent="login">
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
