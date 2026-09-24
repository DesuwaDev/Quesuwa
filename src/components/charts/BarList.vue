<script setup>
import { computed } from 'vue';
import { formatNumber, formatPercent } from '../../lib/format.js';

// Horizontal bars with direct value labels. Items: { label, count, muted }.
const props = defineProps({ items: { type: Array, required: true }, total: { type: Number, default: 0 }, sort: Boolean });
const max = computed(() => Math.max(1, ...props.items.map(item => item.count)));
const rows = computed(() => props.sort ? [...props.items].sort((a, b) => b.count - a.count) : props.items);
</script>

<template>
  <ul class="bar-list">
    <li v-for="item in rows" :key="item.label" :class="{ muted: item.muted }">
      <div class="bar-row-head">
        <span class="bar-label">{{ item.label }}</span>
        <span class="bar-value"><strong>{{ formatNumber(item.count) }}</strong><small v-if="total">{{ formatPercent(item.count, total) }}</small></span>
      </div>
      <div class="bar-track" aria-hidden="true"><span class="bar-fill" :style="{ width: (item.count / max) * 100 + '%' }"></span></div>
    </li>
  </ul>
</template>
