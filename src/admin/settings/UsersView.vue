<script setup>
import { onMounted, ref } from 'vue';
import { t, displayError } from '../../i18n.js';
import { api, session } from '../../lib/api.js';
import { notify, notifyError, confirmDialog } from '../../lib/feedback.js';
import { copyText } from '../../lib/clipboard.js';
import { relativeTime, formatDate } from '../../lib/format.js';
import { roles, roleKeys, roleHintKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import ModalFrame from '../../components/ModalFrame.vue';
import PasswordStrength from '../../components/PasswordStrength.vue';

const users = ref([]), loading = ref(true);
const dialog = ref(null), dialogError = ref(null), saving = ref(false);

async function load() {
  loading.value = true;
  try { users.value = await api('/admin/users'); } catch (error) { notifyError(error); }
  finally { loading.value = false; }
}
onMounted(load);

function generatePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = crypto.getRandomValues(new Uint8Array(18));
  dialog.value.password = [...values].map(value => alphabet[value % alphabet.length]).join('');
  dialog.value.reveal = true;
}
const openCreate = () => { dialogError.value = null; dialog.value = { mode: 'create', username: '', displayName: '', role: 'editor', password: '', reveal: false }; };
const openReset = user => { dialogError.value = null; dialog.value = { mode: 'reset', user, password: '', reveal: false }; };

async function submit() {
  saving.value = true;
  dialogError.value = null;
  const value = dialog.value;
  try {
    if (value.mode === 'create') {
      await api('/admin/users', { method: 'POST', body: { username: value.username.trim(), displayName: value.displayName, role: value.role, password: value.password } });
      notify('users.created');
    } else {
      await api('/admin/users/' + value.user.id + '/password', { method: 'POST', body: { password: value.password } });
      notify('users.passwordReset');
    }
    if (await copyText(value.password)) notify('users.passwordCopied', { type: 'info' });
    dialog.value = null;
    await load();
  } catch (error) { dialogError.value = error; }
  finally { saving.value = false; }
}

async function update(user, changes) {
  try {
    await api('/admin/users/' + user.id, { method: 'PATCH', body: changes });
    notify('users.updated');
  } catch (error) { notifyError(error); }
  await load();
}

async function remove(user) {
  if (!(await confirmDialog({ titleKey: 'users.deleteTitle', messageKey: 'users.deleteConfirm', params: { name: user.username }, danger: true, confirmKey: 'users.delete' }))) return;
  try { await api('/admin/users/' + user.id, { method: 'DELETE' }); notify('users.deleted'); await load(); }
  catch (error) { notifyError(error); }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ t('nav.users') }}</span>
        <h1>{{ t('users.heading') }}</h1>
        <p class="muted">{{ t('users.intro') }}</p>
      </div>
      <div class="page-actions"><button type="button" class="button primary" @click="openCreate"><AppIcon name="plus" :size="16" />{{ t('users.add') }}</button></div>
    </header>

    <div class="role-legend">
      <div v-for="role in roles" :key="role" class="role-card"><strong>{{ t(roleKeys[role]) }}</strong><span>{{ t(roleHintKeys[role]) }}</span></div>
    </div>

    <section class="card flush">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr><th>{{ t('users.member') }}</th><th>{{ t('users.role') }}</th><th>{{ t('users.status') }}</th><th class="hide-narrow">{{ t('users.lastLogin') }}</th><th class="hide-narrow">{{ t('users.sessions') }}</th><th><span class="sr-only">{{ t('common.actions') }}</span></th></tr>
          </thead>
          <tbody :aria-busy="loading">
            <tr v-for="user in users" :key="user.id" :class="{ muted: user.disabled }">
              <td>
                <div class="member-cell">
                  <span class="avatar small">{{ (user.displayName || user.username).slice(0, 1).toUpperCase() }}</span>
                  <span><strong>{{ user.displayName || user.username }}</strong><small class="mono muted">{{ user.username }}</small></span>
                  <span v-if="user.id === session.user.id" class="badge info">{{ t('users.you') }}</span>
                </div>
              </td>
              <td>
                <select class="input select compact" :value="user.role" :disabled="user.id === session.user.id" :aria-label="t('users.role')" @change="update(user, { role: $event.target.value })">
                  <option v-for="role in roles" :key="role" :value="role">{{ t(roleKeys[role]) }}</option>
                </select>
              </td>
              <td><span class="badge" :class="user.disabled ? 'muted' : 'success'">{{ user.disabled ? t('users.disabled') : t('users.active') }}</span></td>
              <td class="hide-narrow" :title="user.lastLoginAt ? formatDate(user.lastLoginAt) : ''">{{ user.lastLoginAt ? relativeTime(user.lastLoginAt) : t('users.never') }}</td>
              <td class="hide-narrow">{{ user.sessions }}</td>
              <td class="row-actions">
                <button type="button" class="button ghost small" @click="openReset(user)"><AppIcon name="key" :size="14" /><span class="hide-narrow">{{ t('users.resetPassword') }}</span></button>
                <template v-if="user.id !== session.user.id">
                  <button type="button" class="button ghost small" @click="update(user, { disabled: !user.disabled })">{{ user.disabled ? t('users.enable') : t('users.disable') }}</button>
                  <button type="button" class="icon-button ghost small danger" :aria-label="t('users.delete')" @click="remove(user)"><AppIcon name="trash" :size="14" /></button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ModalFrame v-if="dialog" :title="dialog.mode === 'create' ? t('users.add') : t('users.resetFor', { name: dialog.user.username })" size="sm" @close="dialog = null">
      <form id="user-dialog" class="stack-form" @submit.prevent="submit">
        <template v-if="dialog.mode === 'create'">
          <label class="field">
            <span class="field-label">{{ t('admin.username') }}</span>
            <input v-model="dialog.username" class="input mono" required maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus />
            <small class="hint">{{ t('users.usernameHint') }}</small>
          </label>
          <label class="field">
            <span class="field-label">{{ t('account.displayName') }}</span>
            <input v-model="dialog.displayName" class="input" maxlength="40" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('users.role') }}</span>
            <select v-model="dialog.role" class="input select">
              <option v-for="role in roles" :key="role" :value="role">{{ t(roleKeys[role]) }}</option>
            </select>
            <small class="hint">{{ t(roleHintKeys[dialog.role]) }}</small>
          </label>
        </template>
        <label class="field">
          <span class="field-label">{{ dialog.mode === 'create' ? t('users.initialPassword') : t('account.newPassword') }}</span>
          <span class="input-affix">
            <input v-model="dialog.password" class="input mono" :type="dialog.reveal ? 'text' : 'password'" required minlength="12" maxlength="128" autocomplete="new-password" />
            <button type="button" class="button ghost small" @click="generatePassword"><AppIcon name="key" :size="14" />{{ t('settings.generate') }}</button>
          </span>
          <PasswordStrength :value="dialog.password" />
          <small class="hint">{{ t('users.passwordHint') }}</small>
        </label>
        <p v-if="dialogError" class="form-error" role="alert"><AppIcon name="alert" :size="16" />{{ displayError(dialogError) }}</p>
      </form>
      <template #actions>
        <button type="button" class="button" @click="dialog = null">{{ t('common.cancel') }}</button>
        <button type="submit" form="user-dialog" class="button primary" :disabled="saving || dialog.password.length < 12">{{ dialog.mode === 'create' ? t('users.create') : t('users.resetPassword') }}</button>
      </template>
    </ModalFrame>
  </div>
</template>
