<script setup>
import { computed, onMounted, ref } from 'vue';
import { t } from '../../i18n.js';
import { api } from '../../lib/api.js';
import { notify, notifyError } from '../../lib/feedback.js';
import { formatBytes, formatDate } from '../../lib/format.js';
import AppIcon from '../../components/AppIcon.vue';
import ToggleSwitch from '../../components/ToggleSwitch.vue';

defineProps({ timezone: { type: String, default: '' } });
const state = ref(null), form = ref(null), saving = ref(false), running = ref(false);
const dirty = computed(() => Boolean(form.value && state.value) && JSON.stringify(form.value) !== JSON.stringify(state.value.config));

function adopt(data) {
  state.value = data;
  form.value = { ...data.config };
}
async function load() {
  try { adopt(await api('/admin/system/backups')); } catch (error) { notifyError(error); }
}
async function save() {
  saving.value = true;
  try { adopt(await api('/admin/system/backups', { method: 'PUT', body: form.value })); notify('backups.saved'); }
  catch (error) { notifyError(error); }
  finally { saving.value = false; }
}
async function run() {
  running.value = true;
  try {
    const data = await api('/admin/system/backups/run', { method: 'POST', body: {} });
    state.value = { ...data, config: state.value.config };
    if (data.status.ok) notify('backups.done'); else notifyError({ code: 'backups.failed', params: { error: data.status.error } });
  } catch (error) { notifyError(error); }
  finally { running.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="card span-2 backup-card">
    <header class="card-header">
      <h2><AppIcon name="shield" :size="18" />{{ t('system.backup') }}</h2>
      <a class="button small" href="/api/admin/system/archive" download><AppIcon name="download" :size="14" />{{ t('backups.archive') }}</a>
    </header>
    <template v-if="state">
      <p class="muted small">{{ t('backups.intro') }}</p>
      <form class="backup-settings" @submit.prevent="save">
        <ToggleSwitch v-model="form.enabled" :label="t('backups.auto')" :hint="t('backups.autoHint', { zone: timezone })" />
        <div class="inline-fields">
          <label class="field">
            <span class="field-label">{{ t('backups.hour') }}</span>
            <select v-model.number="form.hour" class="input select" :disabled="!form.enabled">
              <option v-for="hour in 24" :key="hour" :value="hour - 1">{{ String(hour - 1).padStart(2, '0') }}:00</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ t('backups.keep') }}</span>
            <input v-model.number="form.keep" class="input" type="number" min="1" max="60" step="1" />
          </label>
        </div>
        <div class="button-row">
          <button type="submit" class="button primary small" :disabled="saving || !dirty">{{ t('common.save') }}</button>
          <button type="button" class="button small" :disabled="running" @click="run"><AppIcon name="play" :size="14" />{{ running ? t('backups.running') : t('backups.runNow') }}</button>
        </div>
      </form>
      <p v-if="state.status" class="small status-line" :class="state.status.ok ? 'muted' : 'field-error'">
        <AppIcon :name="state.status.ok ? 'checkCircle' : 'alert'" :size="14" />
        {{ state.status.ok ? t('backups.lastOk', { time: formatDate(state.status.at), count: state.status.copied }) : t('backups.lastFailed', { time: formatDate(state.status.at), error: state.status.error }) }}
      </p>
      <ul v-if="state.items.length" class="backup-list">
        <li v-for="item in state.items" :key="item.name">
          <AppIcon name="database" :size="16" />
          <span class="session-main"><strong class="mono">{{ item.name }}</strong><small class="muted">{{ formatDate(item.createdAt) }} · {{ formatBytes(item.size) }}</small></span>
          <a class="icon-button ghost small" :href="'/api/admin/system/backups/' + item.name" download :aria-label="t('responses.download', { name: item.name })"><AppIcon name="download" :size="14" /></a>
        </li>
      </ul>
      <p v-else class="muted small">{{ t('backups.none') }}</p>
      <details class="samples-disclosure">
        <summary>{{ t('backups.restoreTitle') }}</summary>
        <ul class="tips-list">
          <li>{{ t('backups.restore1') }}</li>
          <li>{{ t('backups.restore2') }}</li>
          <li>{{ t('system.backupTip2') }}</li>
        </ul>
      </details>
    </template>
  </section>
</template>
