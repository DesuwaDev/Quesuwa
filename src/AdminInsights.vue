<script setup>
import { t } from './i18n.js';
import { statusKeys } from './shared.js';
defineProps({ stats: Object });
</script>
<template>
  <section v-if="stats" class="panel insights-panel">
    <h2>{{ t('manage.statistics') }}</h2>
    <div class="stat-grid"><div class="stat-card"><span>{{ t('admin.received') }}</span><strong>{{ stats.total }}</strong></div><div v-for="(count, status) in stats.byStatus" :key="status" class="stat-card"><span>{{ t(statusKeys[status]) }}</span><strong>{{ count }}</strong></div></div>
    <div class="settings-grid">
      <article v-for="(field, index) in stats.fields" :key="index" class="stat-breakdown">
        <h3>{{ field.label }}</h3>
        <p v-if="['rating', 'number'].includes(field.type)">{{ t('manage.average', { value: field.count ? (field.sum / field.count).toFixed(2) : '—', count: field.count }) }}</p>
        <div v-else v-for="(count, option) in field.options" :key="option" class="stat-option"><span>{{ option }}</span><meter :value="count" :max="field.count || 1"></meter><strong>{{ count }}</strong></div>
      </article>
    </div>
    <details v-if="Object.keys(stats.days).length"><summary>{{ t('manage.daily') }}</summary><div class="daily-grid"><div v-for="(count, day) in stats.days" :key="day"><time>{{ day }}</time><strong>{{ count }}</strong></div></div></details>
  </section>
</template>
