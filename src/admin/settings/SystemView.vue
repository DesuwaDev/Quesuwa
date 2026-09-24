<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { t, hasKey } from '../../i18n.js';
import { api } from '../../lib/api.js';
import { notify, notifyError } from '../../lib/feedback.js';
import { formatBytes, formatDate, formatNumber, formatPercent } from '../../lib/format.js';
import { stateKeys, statusKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import PaginationBar from '../../components/PaginationBar.vue';
import { appVersion } from '../../lib/version.js';

const data = ref(null), page = ref(1), loading = ref(false);
const quotaBytes = computed(() => (data.value?.maxStorageMB || 1) * 1024 * 1024);
const usage = computed(() => Math.min(1, (data.value?.bytes || 0) / quotaBytes.value));
const uptime = computed(() => {
  const seconds = data.value?.uptime || 0;
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return days ? t('time.daysHours', { days, hours }) : t('time.hoursMinutes', { hours, minutes });
});

const form = ref(null), saving = ref(false);
const isLocked = key => Boolean(data.value?.settings.locked.includes(key));
const settingsDirty = computed(() => Boolean(form.value && data.value) && JSON.stringify(form.value) !== JSON.stringify(data.value.settings.values));

async function load() {
  loading.value = true;
  try {
    const keepEdits = settingsDirty.value;
    data.value = await api('/admin/system?page=' + page.value);
    if (!keepEdits) form.value = { ...data.value.settings.values };
  } catch (error) { notifyError(error); }
  finally { loading.value = false; }
}

async function saveSettings() {
  saving.value = true;
  try {
    const changes = Object.fromEntries(Object.entries(form.value).filter(([key]) => !isLocked(key)));
    data.value.settings = await api('/admin/system/settings', { method: 'PUT', body: changes });
    form.value = { ...data.value.settings.values };
    notify('system.settingsSaved');
  } catch (error) { notifyError(error); }
  finally { saving.value = false; }
}
watch(page, load);
onMounted(load);

// Audit actions map to translation keys; state and status changes carry their code.
function actionLabel(action) {
  if (action.startsWith('state:')) return t('audit.state', { state: t(stateKeys[action.slice(6)] || 'state.draft') });
  if (action.startsWith('responses:')) {
    const code = action.slice(10);
    if (statusKeys[code]) return t('audit.responsesStatus', { status: t(statusKeys[code]) });
    const key = 'audit.responses.' + code;
    return hasKey(key) ? t(key) : action;
  }
  const key = 'audit.' + action;
  return hasKey(key) ? t(key) : action;
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ t('nav.system') }}</span>
        <h1>{{ t('system.heading') }}</h1>
        <p class="muted">{{ t('system.intro') }}</p>
      </div>
      <div class="page-actions"><button type="button" class="button" :disabled="loading" @click="load"><AppIcon name="refresh" :size="16" />{{ t('common.refresh') }}</button></div>
    </header>

    <template v-if="data">
      <p v-if="data.version !== appVersion.replace(/-dev$/, '')" class="banner warning"><AppIcon name="refresh" :size="16" />{{ t('system.versionMismatch', { page: appVersion, server: data.version }) }}</p>
      <section class="tile-grid">
        <div class="stat-tile"><span class="stat-label"><AppIcon name="forms" :size="15" />{{ t('system.forms') }}</span><strong class="stat-value">{{ formatNumber(data.forms) }}</strong><span class="stat-foot">{{ t('system.inTrash', { count: formatNumber(data.trashedForms) }) }}</span></div>
        <div class="stat-tile"><span class="stat-label"><AppIcon name="inbox" :size="15" />{{ t('system.responses') }}</span><strong class="stat-value">{{ formatNumber(data.responses) }}</strong><span class="stat-foot">{{ t('system.inTrash', { count: formatNumber(data.trashedResponses) }) }}</span></div>
        <div class="stat-tile"><span class="stat-label"><AppIcon name="users" :size="15" />{{ t('system.users') }}</span><strong class="stat-value">{{ formatNumber(data.users) }}</strong></div>
        <div class="stat-tile"><span class="stat-label"><AppIcon name="activity" :size="15" />{{ t('system.uptime') }}</span><strong class="stat-value small">{{ uptime }}</strong><span class="stat-foot">{{ t('system.version', { version: data.version, node: data.node }) }}</span></div>
      </section>

      <section class="card settings-card system-settings">
        <header class="card-header"><h2><AppIcon name="sliders" :size="18" />{{ t('system.settings') }}</h2></header>
        <p class="muted small">{{ t('system.settingsIntro') }}</p>
        <form class="inline-fields" @submit.prevent="saveSettings">
          <label class="field">
            <span class="field-label">{{ t('system.defaultLocale') }}</span>
            <select v-model="form.defaultLocale" class="input select" :disabled="isLocked('defaultLocale')">
              <option value="zh-CN">{{ t('language.zhCN') }}</option>
              <option value="en">{{ t('language.en') }}</option>
            </select>
            <small class="hint">{{ isLocked('defaultLocale') ? t('system.lockedByEnv', { name: 'DEFAULT_LOCALE' }) : t('system.defaultLocaleHint') }}</small>
          </label>
          <label class="field">
            <span class="field-label">{{ t('system.quota') }}</span>
            <input v-model.number="form.maxStorageMB" class="input" type="number" min="1" max="1048576" step="1" :disabled="isLocked('maxStorageMB')" />
            <small class="hint">{{ isLocked('maxStorageMB') ? t('system.lockedByEnv', { name: 'MAX_STORAGE_MB' }) : t('system.quotaHint') }}</small>
          </label>
          <label class="field">
            <span class="field-label">{{ t('system.proxyHops') }}</span>
            <select v-model.number="form.trustProxyHops" class="input select" :disabled="isLocked('trustProxyHops')">
              <option v-for="hops in [0, 1, 2, 3, 4, 5]" :key="hops" :value="hops">{{ hops ? t('system.proxyCount', { count: hops }) : t('system.proxyNone') }}</option>
            </select>
            <small class="hint">{{ isLocked('trustProxyHops') ? t('system.lockedByEnv', { name: 'TRUST_PROXY_HOPS' }) : t('system.proxyHint') }}</small>
          </label>
        </form>
        <p class="hint small"><AppIcon name="globe" :size="14" />{{ data.settings.publicOrigin ? t('system.originFixed', { origin: data.settings.publicOrigin }) : t('system.originAuto') }}</p>
        <div><button type="button" class="button primary" :disabled="saving || !settingsDirty" @click="saveSettings">{{ saving ? t('editor.saving') : t('common.save') }}</button></div>
      </section>

      <div class="analytics-grid">
        <section class="card">
          <header class="card-header"><h2><AppIcon name="database" :size="18" />{{ t('system.storage') }}</h2></header>
          <div class="meter" :class="{ warn: usage > 0.8, danger: usage > 0.95 }" role="meter" :aria-valuenow="Math.round(usage * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="t('system.storage')"><span :style="{ width: usage * 100 + '%' }"></span></div>
          <p class="meter-caption"><strong>{{ formatBytes(data.bytes) }}</strong> / {{ formatBytes(quotaBytes) }} · {{ formatPercent(data.bytes, quotaBytes) }}</p>
          <dl class="kv-list">
            <div><dt>{{ t('system.files') }}</dt><dd>{{ formatNumber(data.files) }}</dd></div>
            <div><dt>{{ t('system.database') }}</dt><dd>{{ formatBytes(data.databaseBytes) }}</dd></div>
          </dl>
          <p v-if="data.pendingCleanup" class="banner warning"><AppIcon name="alert" :size="16" />{{ t('system.cleanupPending', { count: data.pendingCleanup }) }}</p>
        </section>
        <section class="card span-2">
          <header class="card-header"><h2><AppIcon name="shield" :size="18" />{{ t('system.backup') }}</h2></header>
          <ul class="tips-list">
            <li>{{ t('system.backupTip1') }}</li>
            <li>{{ t('system.backupTip2') }}</li>
            <li>{{ t('system.backupTip3') }}</li>
          </ul>
        </section>
      </div>

      <section class="card flush">
        <header class="card-header padded"><h2><AppIcon name="activity" :size="18" />{{ t('system.activity') }}</h2><span class="muted small">{{ t('system.activityCount', { count: formatNumber(data.events.total) }) }}</span></header>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>{{ t('system.time') }}</th><th>{{ t('system.actor') }}</th><th>{{ t('system.action') }}</th><th>{{ t('system.target') }}</th></tr></thead>
            <tbody>
              <tr v-for="(event, index) in data.events.items" :key="index">
                <td class="nowrap">{{ formatDate(event.createdAt) }}</td>
                <td class="mono">{{ event.actor || '—' }}</td>
                <td>{{ actionLabel(event.action) }}</td>
                <td :title="event.target"><span class="clamp-1">{{ event.detail || event.target.slice(0, 8) }}</span></td>
              </tr>
              <tr v-if="!data.events.items.length"><td colspan="4" class="muted center">{{ t('system.noActivity') }}</td></tr>
            </tbody>
          </table>
        </div>
        <footer class="card-footer"><PaginationBar :page="page" :total="data.events.total" :page-size="data.events.pageSize" :disabled="loading" @change="page = $event" /></footer>
      </section>
    </template>
  </div>
</template>
