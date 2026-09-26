<script setup>
import { computed, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { api, session, allowed } from '../lib/api.js';
import { route, navigate } from '../lib/router.js';
import { roleKeys } from '../../shared/constants.js';
import BrandMark from '../components/BrandMark.vue';
import SystemControls from '../components/SystemControls.vue';
import AppIcon from '../components/AppIcon.vue';
import RouterLink from '../components/RouterLink.vue';
import { appVersion } from '../lib/version.js';

const drawer = ref(false);
const nav = computed(() => [
  { to: '/admin', icon: 'dashboard', label: 'nav.dashboard', exact: true },
  { to: '/admin/forms', icon: 'forms', label: 'nav.forms' },
  { to: '/admin/account', icon: 'user', label: 'nav.account' },
  ...(allowed('users.manage') ? [{ to: '/admin/users', icon: 'users', label: 'nav.users' }] : []),
  ...(allowed('system.read') ? [{ to: '/admin/notifications', icon: 'mail', label: 'nav.notifications' }, { to: '/admin/system', icon: 'server', label: 'nav.system' }] : [])
]);
const initials = computed(() => (session.user?.displayName || session.user?.username || '?').trim().slice(0, 1).toUpperCase());
watch(() => route.path, () => { drawer.value = false; });

async function logout() {
  if (!(await navigate('/admin'))) return;
  try { await api('/admin/logout', { method: 'POST', body: {} }); } catch { /* The session may already be gone. */ }
  session.user = null;
}
</script>

<template>
  <div class="admin-shell" :class="{ 'drawer-open': drawer }">
    <header class="admin-topbar">
      <button type="button" class="icon-button ghost" :aria-label="t('nav.menu')" :aria-expanded="drawer" @click="drawer = !drawer"><AppIcon name="menu" /></button>
      <BrandMark to="/admin" />
      <SystemControls compact />
    </header>
    <div v-if="drawer" class="drawer-scrim" @click="drawer = false"></div>
    <aside class="admin-sidebar" :aria-label="t('nav.main')">
      <div class="sidebar-brand"><BrandMark to="/admin" :subtitle="t('admin.subtitle')" /></div>
      <nav class="sidebar-nav">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" :exact="item.exact" class="nav-link" :title="t(item.label)">
          <AppIcon :name="item.icon" :size="18" /><span>{{ t(item.label) }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-footer">
        <SystemControls class="sidebar-controls" />
        <div class="user-chip">
          <span class="avatar">{{ initials }}</span>
          <span class="user-meta"><strong>{{ session.user.displayName || session.user.username }}</strong><small>{{ t(roleKeys[session.user.role]) }}</small></span>
          <button type="button" class="icon-button ghost" :title="t('admin.logout')" :aria-label="t('admin.logout')" @click="logout"><AppIcon name="logout" :size="18" /></button>
        </div>
        <span class="version-tag" :title="t('app.versionLabel', { version: appVersion })">{{ t('app.version', { version: appVersion }) }}</span>
      </div>
    </aside>
    <main class="admin-main" id="main"><slot /></main>
  </div>
</template>
