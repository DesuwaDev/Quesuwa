<script setup>
import { computed, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { localDayStart, todayKey, shiftDay } from '../lib/format.js';

// Emits ISO timestamps for local-day boundaries; "to" is exclusive.
const props = defineProps({ from: String, to: String });
const emit = defineEmits(['update:from', 'update:to']);
const presets = [
  { key: 'all', label: 'range.all' },
  { key: 'today', label: 'range.today', days: 1 },
  { key: '7', label: 'range.days7', days: 7 },
  { key: '30', label: 'range.days30', days: 30 },
  { key: '90', label: 'range.days90', days: 90 },
  { key: 'custom', label: 'range.custom' }
];
const preset = ref(props.from || props.to ? 'custom' : 'all');
const customFrom = ref(''), customTo = ref('');

function apply(key) {
  if (key === 'custom') return applyCustom();
  const item = presets.find(entry => entry.key === key);
  if (!item?.days) { emit('update:from', ''); emit('update:to', ''); return; }
  const today = todayKey();
  emit('update:from', localDayStart(shiftDay(today, -(item.days - 1))));
  emit('update:to', '');
}
function applyCustom() {
  emit('update:from', customFrom.value ? localDayStart(customFrom.value) : '');
  emit('update:to', customTo.value ? localDayStart(customTo.value, 1) : '');
}
watch(preset, apply);
watch([customFrom, customTo], () => { if (preset.value === 'custom') applyCustom(); });
watch(() => [props.from, props.to], ([from, to]) => { if (!from && !to && preset.value !== 'custom') preset.value = 'all'; });
const invalid = computed(() => customFrom.value && customTo.value && customFrom.value > customTo.value);
</script>

<template>
  <div class="date-range">
    <select v-model="preset" class="input select compact" :aria-label="t('range.label')">
      <option v-for="item in presets" :key="item.key" :value="item.key">{{ t(item.label) }}</option>
    </select>
    <template v-if="preset === 'custom'">
      <input v-model="customFrom" class="input compact" type="date" :max="customTo || undefined" :aria-label="t('range.from')" />
      <span class="muted">–</span>
      <input v-model="customTo" class="input compact" type="date" :min="customFrom || undefined" :aria-label="t('range.to')" :aria-invalid="invalid" />
    </template>
  </div>
</template>
