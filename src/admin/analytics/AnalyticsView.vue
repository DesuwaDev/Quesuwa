<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t, locale } from '../../i18n.js';
import { api, query, timezoneOffset } from '../../lib/api.js';
import { notifyError } from '../../lib/feedback.js';
import { formatNumber, formatDuration, formatDay, formatPercent } from '../../lib/format.js';
import { statuses, statusKeys } from '../../../shared/constants.js';
import AppIcon from '../../components/AppIcon.vue';
import EmptyState from '../../components/EmptyState.vue';
import DateRange from '../../components/DateRange.vue';
import ColumnChart from '../../components/charts/ColumnChart.vue';
import BarList from '../../components/charts/BarList.vue';
import QuestionStats from './QuestionStats.vue';

const props = defineProps({ form: { type: Object, required: true } });
const stats = ref(null), loading = ref(false);
const filters = ref({ from: '', to: '', status: '' });
let controller = null;

const params = computed(() => ({ from: filters.value.from, to: filters.value.to, status: filters.value.status }));
async function load() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  try { stats.value = await api('/admin/forms/' + props.form.id + '/statistics' + query({ ...params.value, tz: timezoneOffset() }), { signal: controller.signal }); }
  catch (error) { if (error.name !== 'AbortError') notifyError(error); }
  finally { loading.value = false; }
}
watch(params, load, { deep: true });
onMounted(load);
onBeforeUnmount(() => controller?.abort());

const trend = computed(() => (stats.value?.days || []).map(day => ({ label: formatDay(day.date), detail: formatDay(day.date, { dateStyle: 'full' }), value: day.count })));
const statusItems = computed(() => statuses.map(status => ({ label: t(statusKeys[status]), count: stats.value?.byStatus[status] || 0 })));
const printPage = () => window.print();
</script>

<template>
  <div class="analytics-view" :class="{ refreshing: loading && stats }">
    <div class="toolbar">
      <DateRange v-model:from="filters.from" v-model:to="filters.to" />
      <select v-model="filters.status" class="input select compact" :aria-label="t('responses.filterStatus')">
        <option value="">{{ t('responses.allStatuses') }}</option>
        <option v-for="status in statuses" :key="status" :value="status">{{ t(statusKeys[status]) }}</option>
      </select>
      <span class="spacer"></span>
      <a class="button ghost" :href="'/api/admin/forms/' + form.id + '/export' + query({ ...params, format: 'csv', lang: locale })" download><AppIcon name="download" :size="16" /><span class="hide-narrow">{{ t('export.csvWide') }}</span></a>
      <button type="button" class="button ghost hide-mobile" @click="printPage"><AppIcon name="printer" :size="16" />{{ t('stats.print') }}</button>
    </div>

    <div v-if="!stats" class="tile-grid"><div v-for="index in 4" :key="index" class="skeleton-card short"></div></div>
    <EmptyState v-else-if="!stats.total" icon="chart" :title="t('stats.empty')" :text="t('stats.emptyHint')" />
    <template v-else>
      <section class="tile-grid">
        <div class="stat-tile hero">
          <span class="stat-label">{{ t('stats.responses') }}</span>
          <strong class="stat-value">{{ formatNumber(stats.total) }}</strong>
          <span class="stat-foot">{{ t('stats.starredCount', { count: formatNumber(stats.starred) }) }}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label"><AppIcon name="clock" :size="15" />{{ t('stats.avgDuration') }}</span>
          <strong class="stat-value">{{ formatDuration(stats.duration.avg) }}</strong>
          <span class="stat-foot">{{ t('stats.medianDuration', { time: formatDuration(stats.duration.median) }) }}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label"><AppIcon name="calendar" :size="15" />{{ t('stats.activeDays') }}</span>
          <strong class="stat-value">{{ formatNumber(stats.days.filter(day => day.count).length) }}</strong>
          <span class="stat-foot">{{ t('stats.perDay', { value: formatNumber(stats.total / Math.max(1, stats.days.length), { maximumFractionDigits: 1 }) }) }}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label"><AppIcon name="checkCircle" :size="15" />{{ t('stats.resolved') }}</span>
          <strong class="stat-value">{{ formatPercent(stats.byStatus.resolved || 0, stats.total) }}</strong>
          <span class="stat-foot">{{ t('stats.pendingCount', { count: formatNumber(stats.byStatus.pending || 0) }) }}</span>
        </div>
      </section>

      <div class="analytics-grid">
        <section class="card chart-card span-2">
          <header class="card-header"><h2>{{ t('stats.trend') }}</h2></header>
          <ColumnChart :items="trend" :caption="t('stats.trend')" />
        </section>
        <section class="card">
          <header class="card-header"><h2>{{ t('stats.statusBreakdown') }}</h2></header>
          <BarList :items="statusItems" :total="stats.total" />
        </section>
      </div>

      <h2 class="section-title">{{ t('stats.questions') }}</h2>
      <div class="question-stats-grid">
        <QuestionStats v-for="(field, index) in stats.fields" :key="field.id + field.type" :field="field" :index="index + 1" :form-id="form.id" />
      </div>
    </template>
  </div>
</template>
