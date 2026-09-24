<script setup>
import { computed, ref } from 'vue';
import { t, displayError } from '../i18n.js';
import { api, session } from '../lib/api.js';
import BrandMark from '../components/BrandMark.vue';
import SystemControls from '../components/SystemControls.vue';
import AppIcon from '../components/AppIcon.vue';
import PasswordStrength from '../components/PasswordStrength.vue';

// First run without ADMIN_PASSWORD: create the owner account in the browser.
const emit = defineEmits(['done']);
const code = ref(''), username = ref('admin'), displayName = ref(''), password = ref(''), confirm = ref(''), busy = ref(false), error = ref(null);
const mismatch = computed(() => confirm.value && password.value !== confirm.value);

async function submit() {
  if (mismatch.value) return;
  busy.value = true;
  error.value = null;
  try {
    const data = await api('/admin/setup', { method: 'POST', body: { code: code.value, username: username.value.trim(), displayName: displayName.value, password: password.value } });
    session.user = data.user;
    emit('done');
  } catch (reason) {
    error.value = reason;
    if (reason.code === 'errors.setupDone') emit('done');
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="login-screen">
    <header class="login-top"><BrandMark to="/" :subtitle="t('admin.subtitle')" /><SystemControls compact /></header>
    <main class="login-main">
      <form class="login-card" @submit.prevent="submit">
        <span class="login-badge"><AppIcon name="sparkle" :size="22" /></span>
        <h1>{{ t('setup.title') }}</h1>
        <p class="muted">{{ t('setup.intro') }}</p>
        <label class="field">
          <span class="field-label">{{ t('setup.code') }}</span>
          <input v-model="code" class="input mono" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required autofocus />
          <small class="hint">{{ t('setup.codeHint') }}</small>
        </label>
        <label class="field">
          <span class="field-label">{{ t('admin.username') }}</span>
          <input v-model="username" class="input" name="username" autocomplete="username" required maxlength="32" autocapitalize="off" spellcheck="false" />
          <small class="hint">{{ t('users.usernameHint') }}</small>
        </label>
        <label class="field">
          <span class="field-label">{{ t('account.displayName') }}</span>
          <input v-model="displayName" class="input" maxlength="40" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('admin.password') }}</span>
          <input v-model="password" class="input" type="password" autocomplete="new-password" required minlength="12" maxlength="128" />
          <PasswordStrength :value="password" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('account.confirmPassword') }}</span>
          <input v-model="confirm" class="input" type="password" autocomplete="new-password" required minlength="12" maxlength="128" :aria-invalid="Boolean(mismatch)" />
          <small v-if="mismatch" class="field-error">{{ t('errors.passwordMismatch') }}</small>
        </label>
        <p v-if="error" class="form-error" role="alert"><AppIcon name="alert" :size="16" /><span>{{ displayError(error) }}</span></p>
        <button class="button primary block" type="submit" :disabled="busy || !code.trim() || password.length < 12 || mismatch">{{ busy ? t('common.loading') : t('setup.submit') }}</button>
      </form>
    </main>
  </div>
</template>
