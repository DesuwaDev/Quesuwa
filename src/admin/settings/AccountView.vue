<script setup>
import { computed, onMounted, ref } from 'vue';
import { t, displayError } from '../../i18n.js';
import { api, session } from '../../lib/api.js';
import { notify, notifyError, confirmDialog } from '../../lib/feedback.js';
import { formatDate, describeAgent } from '../../lib/format.js';
import { roleKeys, roleHintKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import PasswordStrength from '../../components/PasswordStrength.vue';

const displayName = ref(session.user.displayName || ''), savingName = ref(false);
const current = ref(''), next = ref(''), confirm = ref(''), passwordError = ref(null), changing = ref(false);
const sessions = ref([]);
const mismatch = computed(() => confirm.value && next.value !== confirm.value);

async function saveName() {
  savingName.value = true;
  try {
    session.user = (await api('/admin/me', { method: 'PATCH', body: { displayName: displayName.value } })).user;
    notify('account.nameSaved');
  } catch (error) { notifyError(error); }
  finally { savingName.value = false; }
}

async function changePassword() {
  passwordError.value = null;
  if (next.value !== confirm.value) { passwordError.value = { code: 'errors.passwordMismatch' }; return; }
  changing.value = true;
  try {
    await api('/admin/password', { method: 'POST', body: { currentPassword: current.value, newPassword: next.value } });
    notify('account.changed');
    session.user = null;
  } catch (error) { passwordError.value = error; }
  finally { changing.value = false; }
}

async function loadSessions() {
  try { sessions.value = await api('/admin/sessions'); } catch (error) { notifyError(error); }
}
async function revoke(item) {
  try { await api('/admin/sessions/' + item.id, { method: 'DELETE' }); notify('account.sessionRevoked'); await loadSessions(); }
  catch (error) { notifyError(error); }
}
async function revokeOthers() {
  if (!(await confirmDialog({ titleKey: 'account.revoke', messageKey: 'account.revokeConfirm', confirmKey: 'account.revoke', danger: true }))) return;
  try { await api('/admin/sessions/revoke', { method: 'POST', body: {} }); notify('account.sessionRevoked'); await loadSessions(); }
  catch (error) { notifyError(error); }
}
onMounted(loadSessions);
</script>

<template>
  <div class="page narrow">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ t('nav.account') }}</span>
        <h1>{{ t('account.heading') }}</h1>
        <p class="muted">{{ t('account.intro') }}</p>
      </div>
    </header>

    <section class="card settings-card">
      <header class="card-header"><h2><AppIcon name="user" :size="18" />{{ t('account.profile') }}</h2></header>
      <dl class="kv-list">
        <div><dt>{{ t('admin.username') }}</dt><dd class="mono">{{ session.user.username }}</dd></div>
        <div><dt>{{ t('users.role') }}</dt><dd>{{ t(roleKeys[session.user.role]) }}<small class="muted">{{ t(roleHintKeys[session.user.role]) }}</small></dd></div>
        <div v-if="session.user.lastLoginAt"><dt>{{ t('users.lastLogin') }}</dt><dd>{{ formatDate(session.user.lastLoginAt) }}</dd></div>
      </dl>
      <form class="inline-form" @submit.prevent="saveName">
        <label class="field grow">
          <span class="field-label">{{ t('account.displayName') }}</span>
          <input v-model="displayName" class="input" maxlength="40" :placeholder="session.user.username" />
        </label>
        <button type="submit" class="button" :disabled="savingName || displayName.trim() === (session.user.displayName || '')">{{ t('common.save') }}</button>
      </form>
    </section>

    <section class="card settings-card">
      <header class="card-header"><h2><AppIcon name="key" :size="18" />{{ t('account.password') }}</h2></header>
      <form class="stack-form" autocomplete="on" @submit.prevent="changePassword">
        <input type="text" name="username" autocomplete="username" :value="session.user.username" hidden readonly />
        <label class="field">
          <span class="field-label">{{ t('account.currentPassword') }}</span>
          <input v-model="current" class="input" type="password" autocomplete="current-password" required />
        </label>
        <label class="field">
          <span class="field-label">{{ t('account.newPassword') }}</span>
          <input v-model="next" class="input" type="password" autocomplete="new-password" minlength="12" maxlength="128" required />
          <PasswordStrength :value="next" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('account.confirmPassword') }}</span>
          <input v-model="confirm" class="input" type="password" autocomplete="new-password" minlength="12" maxlength="128" required :aria-invalid="Boolean(mismatch)" />
          <small v-if="mismatch" class="field-error">{{ t('errors.passwordMismatch') }}</small>
        </label>
        <p class="hint small">{{ t('account.passwordHint') }}</p>
        <p v-if="passwordError" class="form-error" role="alert"><AppIcon name="alert" :size="16" />{{ displayError(passwordError) }}</p>
        <button type="submit" class="button primary align-start" :disabled="changing || !current || next.length < 12 || mismatch">{{ t('account.password') }}</button>
      </form>
    </section>

    <section class="card settings-card">
      <header class="card-header">
        <h2><AppIcon name="monitor" :size="18" />{{ t('account.sessions') }}</h2>
        <button type="button" class="button small" :disabled="sessions.length < 2" @click="revokeOthers">{{ t('account.revoke') }}</button>
      </header>
      <p class="muted small">{{ t('account.sessionHint') }}</p>
      <ul class="session-list">
        <li v-for="item in sessions" :key="item.id">
          <AppIcon :name="/Mobile|Android|iPhone/.test(item.userAgent) ? 'phone' : 'monitor'" :size="18" />
          <span class="session-main">
            <strong>{{ describeAgent(item.userAgent) }}<span v-if="item.current" class="badge success">{{ t('account.current') }}</span></strong>
            <small class="muted">{{ t('account.sessionTimes', { created: formatDate(item.createdAt), expires: formatDate(item.expiresAt) }) }}</small>
          </span>
          <button v-if="!item.current" type="button" class="button ghost small" @click="revoke(item)">{{ t('account.signOut') }}</button>
        </li>
      </ul>
    </section>
  </div>
</template>
