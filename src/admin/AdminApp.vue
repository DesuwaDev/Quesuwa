<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { api, session, allowed } from '../lib/api.js';
import { route } from '../lib/router.js';
import LoginView from './LoginView.vue';
import SetupView from './SetupView.vue';
import AdminLayout from './AdminLayout.vue';
import DashboardView from './DashboardView.vue';
import FormsView from './FormsView.vue';
import FormWorkspace from './FormWorkspace.vue';
import AccountView from './settings/AccountView.vue';
import UsersView from './settings/UsersView.vue';
import SystemView from './settings/SystemView.vue';
import NotificationsView from './settings/NotificationsView.vue';
import EmptyState from '../components/EmptyState.vue';

const tabs = ['edit', 'settings', 'share', 'responses', 'analytics'];
const view = computed(() => {
  const path = route.path;
  if (path === '/admin') return { name: 'dashboard' };
  if (path === '/admin/forms') return { name: 'forms' };
  const match = /^\/admin\/forms\/([0-9a-f-]{36})(?:\/([a-z]+))?$/.exec(path);
  if (match && (!match[2] || tabs.includes(match[2]))) return { name: 'form', id: match[1], tab: match[2] || 'edit' };
  if (path === '/admin/account') return { name: 'account' };
  if (path === '/admin/users') return { name: allowed('users.manage') ? 'users' : 'forbidden' };
  if (path === '/admin/system') return { name: allowed('system.read') ? 'system' : 'forbidden' };
  if (path === '/admin/notifications') return { name: allowed('system.read') ? 'notifications' : 'forbidden' };
  return { name: 'missing' };
});

const setupNeeded = ref(false);
async function check() {
  try { session.user = (await api('/admin/session')).user; }
  catch {
    session.user = null;
    try { setupNeeded.value = (await api('/admin/setup')).needed; } catch { setupNeeded.value = false; }
  }
  finally { session.checked = true; }
}
onMounted(check);
watch(() => session.user?.id, (current, previous) => { if (!current && previous) document.title = t('app.title'); });
</script>

<template>
  <div v-if="!session.checked" class="boot-screen"><span class="spinner"></span></div>
  <SetupView v-else-if="!session.user && setupNeeded" @done="setupNeeded = false" />
  <LoginView v-else-if="!session.user" />
  <AdminLayout v-else>
    <DashboardView v-if="view.name === 'dashboard'" />
    <FormsView v-else-if="view.name === 'forms'" />
    <FormWorkspace v-else-if="view.name === 'form'" :key="view.id" :form-id="view.id" :tab="view.tab" />
    <AccountView v-else-if="view.name === 'account'" />
    <UsersView v-else-if="view.name === 'users'" />
    <SystemView v-else-if="view.name === 'system'" />
    <NotificationsView v-else-if="view.name === 'notifications'" />
    <EmptyState v-else-if="view.name === 'forbidden'" icon="lock" :title="t('errors.forbidden')" />
    <EmptyState v-else icon="alert" :title="t('public.notFound')" :text="t('public.notFoundHint')" />
  </AdminLayout>
</template>
