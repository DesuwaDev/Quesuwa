<script setup>
import { computed } from 'vue';
import { t } from '../../i18n.js';
import { formatNumber, formatPercent } from '../../lib/format.js';

// Diverging composition: detractors and promoters at the poles, passives as the neutral middle.
const props = defineProps({ nps: { type: Object, required: true } });
const total = computed(() => props.nps.promoters + props.nps.passives + props.nps.detractors);
const segments = computed(() => [
  { key: 'detractors', label: t('stats.detractors'), count: props.nps.detractors },
  { key: 'passives', label: t('stats.passives'), count: props.nps.passives },
  { key: 'promoters', label: t('stats.promoters'), count: props.nps.promoters }
]);
</script>

<template>
  <div class="nps-block">
    <div class="nps-score"><strong>{{ nps.score === null ? '—' : (nps.score > 0 ? '+' : '') + nps.score }}</strong><span>{{ t('stats.npsScore') }}</span></div>
    <div class="nps-bar" role="img" :aria-label="segments.map(item => item.label + ' ' + item.count).join(', ')">
      <span v-for="item in segments" v-show="item.count" :key="item.key" :class="'nps-' + item.key" :style="{ flexGrow: item.count }" :title="item.label + ' · ' + formatNumber(item.count)"></span>
    </div>
    <ul class="chart-legend">
      <li v-for="item in segments" :key="item.key"><span class="swatch" :class="'nps-' + item.key"></span>{{ item.label }}<strong>{{ formatNumber(item.count) }}</strong><small>{{ formatPercent(item.count, total) }}</small></li>
    </ul>
  </div>
</template>
