<script setup>
import { computed, onMounted, ref } from 'vue';
import { t } from '../i18n.js';
import { api, session, allowed, timezoneOffset } from '../lib/api.js';
import { linkHandler } from '../lib/router.js';
import { formatNumber, formatDay, relativeTime } from '../lib/format.js';
import { notifyError } from '../lib/feedback.js';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ColumnChart from '../components/charts/ColumnChart.vue';
import NewFormDialog from './NewFormDialog.vue';

const data = ref(null), loading = ref(true), creating = ref(false);
const greeting = computed(() => {
  const hour = new Date().getHours();
  return t(hour < 6 ? 'dashboard.night' : hour < 12 ? 'dashboard.morning' : hour < 18 ? 'dashboard.afternoon' : 'dashboard.evening', { name: session.user.displayName || session.user.username });
});
const trend = computed(() => (data.value?.trend || []).map(day => ({ label: formatDay(day.date), detail: formatDay(day.date, { dateStyle: 'full' }), value: day.count })));
const tiles = computed(() => data.value ? [
  { key: 'dashboard.today', value: data.value.responses.today, icon: 'inbox' },
  { key: 'dashboard.week', value: data.value.responses.week, icon: 'trend' },
  { key: 'dashboard.pending', value: data.value.responses.pending, icon: 'clock' },
  ...(data.value.responses.unread ? [{ key: 'ticket.awaiting', value: data.value.responses.unread, icon: 'message' }] : []),
  { key: 'dashboard.collecting', value: data.value.forms.published, icon: 'forms' }
] : []);

async function load() {
  loading.value = true;
  try { data.value = await api('/admin/overview?tz=' + timezoneOffset()); }
  catch (error) { notifyError(error); }
  finally { loading.value = false; }
}
onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ t('nav.dashboard') }}</span>
        <h1>{{ greeting }}</h1>
        <p class="muted">{{ t('dashboard.intro') }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="button" :disabled="loading" @click="load"><AppIcon name="refresh" :size="16" /><span class="hide-narrow">{{ t('common.refresh') }}</span></button>
        <button v-if="allowed('forms.write')" type="button" class="button primary" @click="creating = true"><AppIcon name="plus" :size="16" />{{ t('forms.new') }}</button>
      </div>
    </header>

    <div v-if="loading && !data" class="tile-grid"><div v-for="index in 4" :key="index" class="skeleton-card short"></div></div>
    <template v-else-if="data">
      <section class="tile-grid">
        <div class="stat-tile hero">
          <span class="stat-label">{{ t('dashboard.total') }}</span>
          <strong class="stat-value">{{ formatNumber(data.responses.total) }}</strong>
          <span class="stat-foot">{{ t('dashboard.month', { count: formatNumber(data.responses.month) }) }}</span>
        </div>
        <div v-for="tile in tiles" :key="tile.key" class="stat-tile">
          <span class="stat-label"><AppIcon :name="tile.icon" :size="15" />{{ t(tile.key) }}</span>
          <strong class="stat-value">{{ formatNumber(tile.value) }}</strong>
        </div>
      </section>

      <div class="dashboard-grid">
        <section class="card chart-card">
          <header class="card-header"><h2>{{ t('dashboard.trend') }}</h2><span class="muted small">{{ t('dashboard.last30') }}</span></header>
          <ColumnChart :items="trend" :caption="t('dashboard.trend')" />
        </section>

        <section class="card">
          <header class="card-header"><h2>{{ t('dashboard.topForms') }}</h2><a class="text-button small" href="/admin/forms" @click="linkHandler('/admin/forms')($event)">{{ t('dashboard.allForms') }}</a></header>
          <EmptyState v-if="!data.top.length" icon="chart" :text="t('dashboard.noTop')" compact />
          <ol v-else class="rank-list">
            <li v-for="(form, index) in data.top" :key="form.id">
              <span class="rank-index">{{ index + 1 }}</span>
              <a :href="'/admin/forms/' + form.id + '/analytics'" @click="linkHandler('/admin/forms/' + form.id + '/analytics')($event)">{{ form.title }}</a>
              <StatusBadge :state="form.state" />
              <strong>{{ formatNumber(form.count) }}</strong>
            </li>
          </ol>
        </section>

        <section class="card span-2">
          <header class="card-header"><h2>{{ t('dashboard.recent') }}</h2></header>
          <EmptyState v-if="!data.recent.length" icon="inbox" :title="t('dashboard.noResponses')" :text="t('dashboard.noResponsesHint')" compact />
          <ul v-else class="activity-list">
            <li v-for="item in data.recent" :key="item.id">
              <a class="activity-row" :href="'/admin/forms/' + item.formId + '/responses?r=' + item.id" @click="linkHandler('/admin/forms/' + item.formId + '/responses?r=' + item.id)($event)">
                <span class="activity-icon"><AppIcon :name="item.starred ? 'star' : 'inbox'" :size="16" :filled="item.starred" /></span>
                <span class="activity-main">
                  <strong>{{ item.formTitle }}</strong>
                  <span class="muted clamp-1">{{ item.summary || (item.attachments ? t('responses.onlyFiles') : t('responses.noAnswers')) }}</span>
                </span>
                <StatusBadge :status="item.status" />
                <time class="muted small" :datetime="item.createdAt">{{ relativeTime(item.createdAt) }}</time>
              </a>
            </li>
          </ul>
        </section>
      </div>

      <section class="summary-strip">
        <span>{{ t('dashboard.formsSummary', { total: data.forms.total, draft: data.forms.draft, published: data.forms.published, closed: data.forms.closed }) }}</span>
      </section>
    </template>
    <NewFormDialog v-if="creating" @close="creating = false" />
  </div>
</template>
