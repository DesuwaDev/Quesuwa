<script setup>
import { computed } from 'vue';
import { t } from '../../i18n.js';
import AppIcon from '../../components/AppIcon.vue';

// Rating (stars), linear scale and NPS share one radio-group implementation.
const props = defineProps({ field: Object, state: Object, disabled: Boolean, describedBy: String });
const range = computed(() => {
  const [low, high] = props.field.type === 'rating' ? [1, props.field.ratingMax || 5] : props.field.type === 'nps' ? [0, 10] : [props.field.scaleMin ?? 1, props.field.scaleMax || 5];
  return Array.from({ length: high - low + 1 }, (_, index) => String(low + index));
});
const value = computed(() => props.state.answers[props.field.id] ?? '');
const stars = computed(() => props.field.type === 'rating');
const minLabel = computed(() => props.field.minLabel || (props.field.type === 'nps' ? t('form.npsLow') : ''));
const maxLabel = computed(() => props.field.maxLabel || (props.field.type === 'nps' ? t('form.npsHigh') : ''));
const set = next => { props.state.answers[props.field.id] = next; };
const tone = number => props.field.type !== 'nps' ? '' : Number(number) <= 6 ? 'low' : Number(number) <= 8 ? 'mid' : 'high';
</script>

<template>
  <div class="scale-answer" :class="{ stars, nps: field.type === 'nps' }" role="radiogroup" :aria-describedby="describedBy">
    <div class="scale-options" :style="{ '--count': range.length, '--cols': range.length <= 7 ? range.length : Math.ceil(range.length / 2) }">
      <label v-for="number in range" :key="number" class="scale-option" :class="[tone(number), { checked: value === number, filled: stars && value && Number(number) <= Number(value) }]">
        <input type="radio" :name="'q-' + field.id" :value="number" :checked="value === number" :disabled="disabled" :aria-label="stars ? t('form.starLabel', { count: number, max: range.length }) : number" @change="set(number)" />
        <AppIcon v-if="stars" name="star" :size="28" :filled="Boolean(value) && Number(number) <= Number(value)" />
        <span v-else>{{ number }}</span>
      </label>
    </div>
    <div v-if="minLabel || maxLabel" class="scale-labels" aria-hidden="true"><span>{{ minLabel }}</span><span>{{ maxLabel }}</span></div>
    <div class="scale-footer">
      <span v-if="stars && value" class="muted small">{{ t('form.starValue', { count: value, max: range.length }) }}</span>
      <button v-if="value && !field.required && !disabled" type="button" class="text-button small" @click="set('')">{{ t('form.clearChoice') }}</button>
    </div>
  </div>
</template>
