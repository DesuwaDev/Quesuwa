<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { t, hasKey } from '../../i18n.js';
import { api } from '../../lib/api.js';
import { notify, notifyError } from '../../lib/feedback.js';
import { formatBytes, formatDate, formatNumber, formatPercent, relativeTime } from '../../lib/format.js';
import { route, updateQuery } from '../../lib/router.js';
import { stateKeys, statusKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import PaginationBar from '../../components/PaginationBar.vue';
import { appVersion } from '../../lib/version.js';
import BackupCard from './BackupCard.vue';
import CaptchaCard from './CaptchaCard.vue';

// Sections are tabs rather than one long page; the current one lives in ?tab= so reloads,
// back/forward and shared links land on the same section.
const TABS = [
  { key: 'overview', icon: 'dashboard', label: 'system.tabOverview' },
  { key: 'settings', icon: 'sliders', label: 'system.tabSettings' },
  { key: 'backup', icon: 'archive', label: 'system.tabBackup' },
  { key: 'captcha', icon: 'shield', label: 'system.tabCaptcha' },
  { key: 'activity', icon: 'activity', label: 'system.tabActivity' }
];
const tab = computed(() => TABS.some(item => item.key === route.query.tab) ? route.query.tab : 'overview');
// A section is built the first time it is opened and then kept, so unsaved edits survive tab switches.
const visited = reactive(new Set([tab.value]));
watch(tab, value => { visited.add(value); if (value === 'overview') loadSummary(); });
const open = key => updateQuery({ tab: key === 'overview' ? '' : key }, { replace: false });

const zones = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
const CHANNELS = { cap: 'Cap', turnstile: 'Turnstile', hcaptcha: 'hCaptcha', recaptcha: 'reCAPTCHA v2', recaptchaV3: 'reCAPTCHA v3' };

const data = ref(null), page = ref(1), loading = ref(false), recent = ref([]);
const summary = ref({ backups: null, captcha: null });
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
    if (page.value === 1) recent.value = data.value.events.items.slice(0, 5);
    if (!keepEdits) form.value = { ...data.value.settings.values };
  } catch (error) { notifyError(error); }
  finally { loading.value = false; }
}
// Backup and verification status for the overview cards.
async function loadSummary() {
  const [backups, captcha] = await Promise.all([api('/admin/system/backups').catch(() => null), api('/admin/system/captcha').catch(() => null)]);
  summary.value = { backups, captcha: captcha?.config || null };
}
const refresh = () => Promise.all([load(), loadSummary()]);

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
onMounted(refresh);

const backupLine = computed(() => {
  const config = summary.value.backups?.config;
  if (!config) return '';
  return config.enabled ? t('system.backupAuto', { time: String(config.hour).padStart(2, '0') + ':00', keep: config.keep }) : t('system.backupManual');
});
const captchaChannels = computed(() => (summary.value.captcha?.accepted || []).map(id => CHANNELS[id] || id).join(' / '));

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
  <div class="page system-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ t('nav.system') }}</span>
        <h1>{{ t('system.heading') }}</h1>
        <p class="muted">{{ t('system.intro') }}</p>
      </div>
      <div class="page-actions"><button type="button" class="button" :disabled="loading" @click="refresh"><AppIcon name="refresh" :size="16" /><span class="hide-narrow">{{ t('common.refresh') }}</span></button></div>
    </header>

    <nav class="tabs" :aria-label="t('system.sections')">
      <a v-for="item in TABS" :key="item.key" class="tab" :class="{ active: tab === item.key }" :href="item.key === 'overview' ? '/admin/system' : '/admin/system?tab=' + item.key" :aria-current="tab === item.key ? 'page' : undefined" @click.prevent="open(item.key)">
        <AppIcon :name="item.icon" :size="16" /><span>{{ t(item.label) }}</span>
      </a>
    </nav>

    <template v-if="data">
      <p v-if="data.version !== appVersion.replace(/-dev$/, '')" class="banner warning"><AppIcon name="refresh" :size="16" />{{ t('system.versionMismatch', { page: appVersion, server: data.version }) }}</p>

      <div v-show="tab === 'overview'" class="system-overview">
        <section class="system-tiles">
          <div class="stat-tile"><span class="stat-label"><AppIcon name="forms" :size="15" />{{ t('system.forms') }}</span><strong class="stat-value">{{ formatNumber(data.forms) }}</strong><span class="stat-foot">{{ t('system.inTrash', { count: formatNumber(data.trashedForms) }) }}</span></div>
          <div class="stat-tile"><span class="stat-label"><AppIcon name="inbox" :size="15" />{{ t('system.responses') }}</span><strong class="stat-value">{{ formatNumber(data.responses) }}</strong><span class="stat-foot">{{ t('system.inTrash', { count: formatNumber(data.trashedResponses) }) }}</span></div>
          <div class="stat-tile"><span class="stat-label"><AppIcon name="users" :size="15" />{{ t('system.users') }}</span><strong class="stat-value">{{ formatNumber(data.users) }}</strong></div>
          <div class="stat-tile"><span class="stat-label"><AppIcon name="activity" :size="15" />{{ t('system.uptime') }}</span><strong class="stat-value small">{{ uptime }}</strong><span class="stat-foot">{{ t('system.version', { version: data.version, node: data.node }) }}</span></div>
        </section>

        <div class="summary-grid">
          <section class="card summary-card">
            <header class="summary-head"><AppIcon name="database" :size="18" /><h2>{{ t('system.storage') }}</h2></header>
            <div class="meter" :class="{ warn: usage > 0.8, danger: usage > 0.95 }" role="meter" :aria-valuenow="Math.round(usage * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="t('system.storage')"><span :style="{ width: usage * 100 + '%' }"></span></div>
            <p class="meter-caption"><strong>{{ formatBytes(data.bytes) }}</strong> / {{ formatBytes(quotaBytes) }} · {{ formatPercent(data.bytes, quotaBytes) }}</p>
            <p class="summary-meta">{{ t('system.storageMeta', { files: formatNumber(data.files), database: formatBytes(data.databaseBytes) }) }}</p>
            <p v-if="data.pendingCleanup" class="banner warning small"><AppIcon name="alert" :size="14" />{{ t('system.cleanupPending', { count: data.pendingCleanup }) }}</p>
            <button type="button" class="text-button small summary-link" @click="open('settings')">{{ t('system.adjustQuota') }}<AppIcon name="chevronRight" :size="14" /></button>
          </section>

          <section class="card summary-card">
            <header class="summary-head"><AppIcon name="archive" :size="18" /><h2>{{ t('system.backup') }}</h2></header>
            <template v-if="summary.backups">
              <p class="summary-status"><span class="badge" :class="summary.backups.config.enabled ? 'success' : 'muted'">{{ summary.backups.config.enabled ? t('system.on') : t('system.off') }}</span>{{ backupLine }}</p>
              <p class="summary-meta">
                <template v-if="summary.backups.status">{{ summary.backups.status.ok ? t('system.lastBackup', { time: relativeTime(summary.backups.status.at) }) : t('system.lastBackupFailed', { time: relativeTime(summary.backups.status.at) }) }}</template>
                <template v-else>{{ t('backups.none') }}</template>
                · {{ t('system.snapshots', { count: summary.backups.items.length }) }}
              </p>
            </template>
            <button type="button" class="text-button small summary-link" @click="open('backup')">{{ t('system.manage') }}<AppIcon name="chevronRight" :size="14" /></button>
          </section>

          <section class="card summary-card">
            <header class="summary-head"><AppIcon name="shield" :size="18" /><h2>{{ t('captcha.title') }}</h2></header>
            <template v-if="summary.captcha">
              <p class="summary-status"><span class="badge" :class="captchaChannels ? 'success' : 'muted'">{{ captchaChannels ? t('system.on') : t('system.off') }}</span>{{ captchaChannels || t('system.captchaOffHint') }}</p>
              <p class="summary-meta">{{ t('system.captchaPerForm') }}</p>
            </template>
            <button type="button" class="text-button small summary-link" @click="open('captcha')">{{ t('system.manage') }}<AppIcon name="chevronRight" :size="14" /></button>
          </section>
        </div>

        <section class="card flush">
          <header class="card-header padded"><h2><AppIcon name="activity" :size="18" />{{ t('system.recentActivity') }}</h2><button type="button" class="text-button small" @click="open('activity')">{{ t('system.viewAll') }}<AppIcon name="chevronRight" :size="14" /></button></header>
          <ul class="recent-list">
            <li v-for="(event, index) in recent" :key="index">
              <span class="recent-action">{{ actionLabel(event.action) }}<small v-if="event.detail || event.target" class="muted clamp-1">{{ event.detail || event.target.slice(0, 8) }}</small></span>
              <span class="recent-meta"><span class="mono">{{ event.actor || '—' }}</span><time :datetime="event.createdAt" :title="formatDate(event.createdAt)">{{ relativeTime(event.createdAt) }}</time></span>
            </li>
            <li v-if="!recent.length" class="muted">{{ t('system.noActivity') }}</li>
          </ul>
        </section>
      </div>

      <section v-show="tab === 'settings'" class="card settings-card system-settings">
        <header class="card-header"><h2><AppIcon name="sliders" :size="18" />{{ t('system.settings') }}</h2></header>
        <p class="muted small">{{ t('system.settingsIntro') }}</p>
        <form class="settings-fields" @submit.prevent="saveSettings">
          <label class="field">
            <span class="field-label">{{ t('system.defaultLocale') }}</span>
            <select v-model="form.defaultLocale" class="input select" :disabled="isLocked('defaultLocale')">
              <option value="zh-CN">{{ t('language.zhCN') }}</option>
              <option value="en">{{ t('language.en') }}</option>
            </select>
            <small class="hint">{{ isLocked('defaultLocale') ? t('system.lockedByEnv', { name: 'DEFAULT_LOCALE' }) : t('system.defaultLocaleHint') }}</small>
          </label>
          <label class="field">
            <span class="field-label">{{ t('system.timezone') }}</span>
            <input v-model.trim="form.timezone" class="input" list="timezone-list" maxlength="64" autocomplete="off" spellcheck="false" :disabled="isLocked('timezone')" />
            <datalist id="timezone-list"><option v-for="zone in zones" :key="zone" :value="zone" /></datalist>
            <small class="hint">{{ isLocked('timezone') ? t('system.lockedByEnv', { name: 'TZ' }) : t('system.timezoneHint') }}</small>
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

      <BackupCard v-if="visited.has('backup')" v-show="tab === 'backup'" :timezone="data.settings.values.timezone" />
      <CaptchaCard v-if="visited.has('captcha')" v-show="tab === 'captcha'" />

      <section v-show="tab === 'activity'" class="card flush">
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
