<script setup>
import { ref, computed } from 'vue';
import { t, locale, displayError } from './i18n.js';
const props = defineProps({ data: Object, sessions: Array, request: Function });
const emit = defineEmits(['passwordChanged', 'refresh']);
const currentPassword = ref(''), newPassword = ref(''), confirmPassword = ref(''), error = ref(''), busy = ref(false);
const eventPage = ref(1);
const eventPageSize = ref(8);
const eventTotalPages = computed(() => Math.max(1, Math.ceil((props.data?.events?.length || 0) / eventPageSize.value)));
const paginatedEvents = computed(() => {
  const list = props.data?.events || [];
  const max = eventTotalPages.value;
  const current = Math.min(Math.max(1, eventPage.value), max);
  const start = (current - 1) * eventPageSize.value;
  return list.slice(start, start + eventPageSize.value);
});
async function changePassword() {
  error.value = '';
  if (newPassword.value !== confirmPassword.value) { error.value = { code: 'errors.passwordMismatch' }; return; }
  busy.value = true;
  try {
    await props.request('/admin/password', { method: 'POST', body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }) });
    currentPassword.value = ''; newPassword.value = ''; confirmPassword.value = '';
    emit('passwordChanged');
  } catch (value) { error.value = value; } finally { busy.value = false; }
}
async function revokeSessions() {
  busy.value = true; error.value = '';
  try { await props.request('/admin/sessions/revoke', { method: 'POST', body: '{}' }); emit('refresh'); }
  catch (value) { error.value = value; } finally { busy.value = false; }
}
const actions = { createForm: 'audit.create', updateForm: 'audit.update', duplicate: 'audit.duplicate', trashForm: 'audit.trash', purgeForm: 'audit.purge', restoreForm: 'audit.restore', status: 'audit.status', trash: 'audit.trashResponses', restore: 'audit.restoreResponses', purge: 'audit.purgeResponses' };
</script>
<template>
  <section v-if="data" class="panel system-panel">
    <h2>{{ t('manage.system') }}</h2>
    <div class="stat-grid"><div class="stat-card"><span>{{ t('admin.allForms') }}</span><strong>{{ data.forms }}</strong></div><div class="stat-card"><span>{{ t('admin.received') }}</span><strong>{{ data.responses }}</strong></div><div class="stat-card"><span>{{ t('manage.storage') }}</span><strong>{{ t('manage.megabytes', { value: (data.bytes / 1048576).toFixed(1) }) }}</strong><small>{{ t('manage.files', { count: data.files }) }}</small></div></div>
    <p class="hint">{{ t('manage.quota', { size: data.maxStorageMB }) }}</p>
    <p class="hint">{{ t('manage.backupHint') }}</p>
    <p v-if="data.pendingCleanup" class="error">{{ t('manage.cleanupPending', { count: data.pendingCleanup }) }}</p>
    <div class="settings-grid account-grid">
      <form id="admin-password-change" method="post" @submit.prevent="changePassword">
        <h3>{{ t('account.password') }}</h3>
        <label class="stack-label"><span>{{ t('account.currentPassword') }}</span><input type="password" name="current-password" autocomplete="current-password" v-model="currentPassword" required /></label>
        <label class="stack-label"><span>{{ t('account.newPassword') }}</span><input type="password" name="new-password" autocomplete="new-password" v-model="newPassword" minlength="16" maxlength="128" required /></label>
        <label class="stack-label"><span>{{ t('account.confirmPassword') }}</span><input type="password" name="confirm-password" autocomplete="new-password" v-model="confirmPassword" minlength="16" maxlength="128" required /></label>
        <p class="hint">{{ t('account.passwordHint') }}</p>
        <button type="submit" class="button" :disabled="busy">{{ t('account.password') }}</button>
      </form>
      <section><h3>{{ t('account.sessions') }}</h3><p class="hint">{{ t('account.sessionHint') }}</p><div class="sessions-list"><div v-for="(session, index) in sessions" :key="index" class="session-row"><time>{{ new Date(session.createdAt).toLocaleString(locale) }}</time><span>{{ session.current ? t('account.current') : t('account.other') }}</span></div></div><button class="button" :disabled="busy" @click="revokeSessions">{{ t('account.revoke') }}</button></section>
    </div>
    <p v-if="error" class="error" role="alert">{{ displayError(error) }}</p>
    <h3>{{ t('manage.activity') }}</h3>
    <div class="table-scroll"><table class="management-table"><thead><tr><th>{{ t('csv.time') }}</th><th>{{ t('manage.action') }}</th><th>{{ t('manage.target') }}</th></tr></thead><tbody><tr v-for="(event, index) in paginatedEvents" :key="index"><td>{{ new Date(event.createdAt).toLocaleString(locale) }}</td><td>{{ t(actions[event.action]) }}</td><td class="mono">{{ event.target.slice(0, 8) }}</td></tr></tbody></table></div>
    <div v-if="(data.events?.length || 0) > eventPageSize" class="pagination">
      <button class="button" :disabled="eventPage <= 1" @click="eventPage--">
        {{ t('responses.previous') }}
      </button>
      <span>{{ eventPage }} / {{ eventTotalPages }}</span>
      <button class="button" :disabled="eventPage >= eventTotalPages" @click="eventPage++">
        {{ t('responses.next') }}
      </button>
    </div>
    <p v-if="!data.events.length" class="muted">{{ t('manage.noActivity') }}</p>
  </section>
</template>
