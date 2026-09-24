<script setup>
import { computed } from 'vue';
import { t } from '../../i18n.js';
import { LIMITS } from '../../../shared/constants.js';

const props = defineProps({ field: Object, state: Object, disabled: Boolean, describedBy: String, invalid: Boolean });
const types = { short: 'text', email: 'email', phone: 'tel', url: 'url', number: 'text', date: 'date', time: 'time' };
const modes = { number: 'decimal', phone: 'tel', email: 'email', url: 'url' };
const completes = { email: 'email', phone: 'tel', url: 'url' };
const placeholders = { email: 'form.emailPlaceholder', phone: 'form.phonePlaceholder', url: 'form.urlPlaceholder', number: 'form.numberPlaceholder', long: 'form.longPlaceholder', short: 'form.shortPlaceholder' };

const value = computed({
  get: () => props.state.answers[props.field.id] ?? '',
  set: next => { props.state.answers[props.field.id] = next; }
});
const limit = computed(() => props.field.type === 'long' ? props.field.maxLength || LIMITS.longText : props.field.type === 'short' ? props.field.maxLength || LIMITS.shortText : LIMITS.shortText);
const showCounter = computed(() => ['short', 'long'].includes(props.field.type) && (limit.value < (props.field.type === 'long' ? LIMITS.longText : LIMITS.shortText) || value.value.length > limit.value * 0.8 || props.field.minLength > 0));
const placeholder = computed(() => props.field.placeholder || (placeholders[props.field.type] ? t(placeholders[props.field.type]) : ''));
const rangeHint = computed(() => {
  if (props.field.type !== 'number') return '';
  const { min, max } = props.field;
  if (min !== null && min !== undefined && max !== null && max !== undefined) return t('form.rangeBetween', { min, max });
  if (min !== null && min !== undefined) return t('form.rangeMin', { min });
  if (max !== null && max !== undefined) return t('form.rangeMax', { max });
  return '';
});
</script>

<template>
  <div class="text-answer">
    <textarea
      v-if="field.type === 'long'"
      :id="'q-' + field.id"
      v-model="value"
      class="input textarea autosize"
      rows="4"
      :maxlength="limit"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-describedby="describedBy"
      :aria-invalid="invalid"
      :aria-required="field.required"
    ></textarea>
    <input
      v-else
      :id="'q-' + field.id"
      v-model="value"
      class="input"
      :type="types[field.type]"
      :inputmode="modes[field.type]"
      :autocomplete="completes[field.type] || 'off'"
      :maxlength="['date', 'time'].includes(field.type) ? undefined : limit"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-describedby="describedBy"
      :aria-invalid="invalid"
      :aria-required="field.required"
    />
    <div v-if="showCounter || rangeHint" class="field-meta">
      <span>{{ rangeHint }}</span>
      <span v-if="showCounter" :class="{ warn: value.length > limit * 0.95 }">{{ t('form.counter', { count: value.length, max: limit }) }}</span>
    </div>
  </div>
</template>
