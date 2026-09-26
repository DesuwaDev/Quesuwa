<script setup>
import { computed, onMounted, ref } from 'vue';
import { t } from '../../i18n.js';
import { api } from '../../lib/api.js';
import { notify, notifyError, confirmDialog } from '../../lib/feedback.js';
import { copyText } from '../../lib/clipboard.js';
import { formatDate } from '../../lib/format.js';
import AppIcon from '../../components/AppIcon.vue';

const tokens = ref([]), name = ref(''), scope = ref('read'), days = ref(90), busy = ref(false), created = ref(null);
const example = computed(() => created.value && `curl -H "Authorization: Bearer ${created.value.secret}" ${location.origin}/api/admin/forms`);
const expired = item => item.expiresAt && Date.parse(item.expiresAt) <= Date.now();

async function load() {
  try { tokens.value = await api('/admin/tokens'); } catch (error) { notifyError(error); }
}

async function create() {
  busy.value = true;
  try {
    created.value = await api('/admin/tokens', { method: 'POST', body: { name: name.value.trim(), scope: scope.value, days: Number(days.value) } });
    name.value = '';
    await load();
  } catch (error) { notifyError(error); }
  finally { busy.value = false; }
}

async function revoke(item) {
  if (!(await confirmDialog({ titleKey: 'tokens.revoke', messageKey: 'tokens.revokeConfirm', params: { name: item.name }, confirmKey: 'tokens.revoke', danger: true }))) return;
  try {
    await api('/admin/tokens/' + item.id, { method: 'DELETE' });
    if (created.value?.token.id === item.id) created.value = null;
    notify('tokens.revoked');
    await load();
  } catch (error) { notifyError(error); }
}

async function copy(value) {
  if (await copyText(value)) notify('share.copied');
}
onMounted(load);
</script>

<template>
  <section class="card settings-card">
    <header class="card-header"><h2><AppIcon name="key" :size="18" />{{ t('tokens.title') }}</h2></header>
    <p class="muted small">{{ t('tokens.intro') }}</p>

    <div v-if="created" class="token-created">
      <p class="banner success"><AppIcon name="checkCircle" :size="16" /><span>{{ t('tokens.createdOnce') }}</span></p>
      <span class="input-affix">
        <code class="secret-code mono">{{ created.secret }}</code>
        <button type="button" class="button small" @click="copy(created.secret)"><AppIcon name="copy" :size="14" />{{ t('common.copy') }}</button>
      </span>
      <p class="small muted">{{ t('tokens.usage') }}</p>
      <pre class="code-sample"><code>{{ example }}</code></pre>
      <div class="button-row">
        <button type="button" class="button ghost small" @click="copy(example)"><AppIcon name="copy" :size="14" />{{ t('tokens.copyExample') }}</button>
        <button type="button" class="button primary small" @click="created = null">{{ t('common.done') }}</button>
      </div>
    </div>

    <form class="token-form" @submit.prevent="create">
      <label class="field grow">
        <span class="field-label">{{ t('tokens.name') }}</span>
        <input v-model="name" class="input" maxlength="60" required :placeholder="t('tokens.namePlaceholder')" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('tokens.scope') }}</span>
        <select v-model="scope" class="input">
          <option value="read">{{ t('tokens.scopeRead') }}</option>
          <option value="write">{{ t('tokens.scopeWrite') }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">{{ t('tokens.expiry') }}</span>
        <select v-model="days" class="input">
          <option v-for="value in [30, 90, 365]" :key="value" :value="value">{{ t('tokens.days', { count: value }) }}</option>
          <option :value="0">{{ t('tokens.never') }}</option>
        </select>
      </label>
      <button type="submit" class="button primary" :disabled="busy || !name.trim() || tokens.length >= 20"><AppIcon name="plus" :size="14" />{{ t('tokens.create') }}</button>
    </form>
    <p class="hint small">{{ t('tokens.limits') }}</p>

    <ul v-if="tokens.length" class="session-list">
      <li v-for="item in tokens" :key="item.id">
        <AppIcon name="key" :size="18" />
        <span class="session-main">
          <strong>{{ item.name }}<span class="badge" :class="item.scope === 'write' ? 'warning' : 'muted'">{{ item.scope === 'write' ? t('tokens.scopeWrite') : t('tokens.scopeRead') }}</span><span v-if="expired(item)" class="badge danger">{{ t('tokens.expired') }}</span></strong>
          <small class="muted"><span class="mono">{{ item.prefix }}…</span> · {{ t('tokens.meta', { created: formatDate(item.createdAt, { time: false }), used: item.lastUsedAt ? formatDate(item.lastUsedAt) : t('tokens.unused'), expires: item.expiresAt ? formatDate(item.expiresAt, { time: false }) : t('tokens.never') }) }}</small>
        </span>
        <button type="button" class="button ghost small" @click="revoke(item)">{{ t('tokens.revoke') }}</button>
      </li>
    </ul>
  </section>
</template>
