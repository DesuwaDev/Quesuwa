<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatNumber } from '../../lib/format.js';

// Single-series column chart with a hover/focus readout. Items: { label, value, detail }.
const props = defineProps({
  items: { type: Array, required: true },
  height: { type: Number, default: 200 },
  labelEvery: { type: Number, default: 0 },
  caption: { type: String, default: '' },
  valueLabel: { type: Function, default: value => formatNumber(value) }
});

const root = ref(null), width = ref(600), active = ref(-1);
let observer;
onMounted(() => {
  observer = new ResizeObserver(entries => { width.value = Math.max(240, Math.floor(entries[0].contentRect.width)); });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const pad = { top: 16, right: 8, bottom: 28, left: 36 };
function niceMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate * 4 >= value);
  return step * 4;
}
const max = computed(() => niceMax(Math.max(0, ...props.items.map(item => item.value))));
const plotWidth = computed(() => width.value - pad.left - pad.right);
const plotHeight = computed(() => props.height - pad.top - pad.bottom);
const band = computed(() => plotWidth.value / Math.max(1, props.items.length));
const barWidth = computed(() => Math.max(2, Math.min(24, band.value * 0.72 - 2)));
const ticks = computed(() => [0, 1, 2, 3, 4].map(index => (max.value / 4) * index));
const y = value => pad.top + plotHeight.value - (value / max.value) * plotHeight.value;
const every = computed(() => props.labelEvery || Math.max(1, Math.ceil(props.items.length / Math.max(2, Math.floor(plotWidth.value / 56)))));

// Rounded data end (4px) with a square baseline.
function barPath(index, value) {
  const x = pad.left + band.value * index + (band.value - barWidth.value) / 2;
  const top = y(value), bottom = pad.top + plotHeight.value;
  const h = bottom - top;
  if (h <= 0) return '';
  const r = Math.min(4, barWidth.value / 2, h);
  const w = barWidth.value;
  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
}

function pointer(event) {
  const rect = root.value.getBoundingClientRect();
  const index = Math.floor((event.clientX - rect.left - pad.left) / band.value);
  active.value = index >= 0 && index < props.items.length ? index : -1;
}
function keydown(event) {
  if (!props.items.length) return;
  if (event.key === 'ArrowRight') active.value = Math.min(props.items.length - 1, active.value + 1);
  else if (event.key === 'ArrowLeft') active.value = Math.max(0, (active.value < 0 ? props.items.length : active.value) - 1);
  else return;
  event.preventDefault();
}
const tooltip = computed(() => {
  const item = props.items[active.value];
  if (!item) return null;
  const x = pad.left + band.value * active.value + band.value / 2;
  return { item, left: Math.min(Math.max(x, 70), width.value - 70), top: Math.max(8, y(item.value) - 12) };
});
</script>

<template>
  <figure ref="root" class="chart column-chart">
    <svg :width="width" :height="height" role="img" :aria-label="caption" tabindex="0" @pointermove="pointer" @pointerleave="active = -1" @keydown="keydown" @blur="active = -1">
      <g class="chart-grid">
        <g v-for="tick in ticks" :key="tick">
          <line :x1="pad.left" :x2="width - pad.right" :y1="y(tick)" :y2="y(tick)" />
          <text :x="pad.left - 8" :y="y(tick)" dy="0.32em" text-anchor="end">{{ formatNumber(tick, { maximumFractionDigits: 1 }) }}</text>
        </g>
      </g>
      <rect v-if="active >= 0" class="chart-hover-band" :x="pad.left + band * active" :y="pad.top" :width="band" :height="plotHeight" />
      <path v-for="(item, index) in items" :key="index" class="chart-bar" :class="{ dim: active >= 0 && active !== index }" :d="barPath(index, item.value)" />
      <g class="chart-axis">
        <template v-for="(item, index) in items" :key="index">
          <text v-if="index % every === 0 || index === items.length - 1 && items.length <= 12" :x="pad.left + band * index + band / 2" :y="height - 8" text-anchor="middle">{{ item.label }}</text>
        </template>
      </g>
    </svg>
    <div v-if="tooltip" class="chart-tooltip" :style="{ left: tooltip.left + 'px', top: tooltip.top + 'px' }">
      <strong>{{ valueLabel(tooltip.item.value) }}</strong>
      <span>{{ tooltip.item.detail || tooltip.item.label }}</span>
    </div>
    <table class="sr-only">
      <caption>{{ caption }}</caption>
      <tbody><tr v-for="(item, index) in items" :key="index"><th scope="row">{{ item.detail || item.label }}</th><td>{{ valueLabel(item.value) }}</td></tr></tbody>
    </table>
  </figure>
</template>
