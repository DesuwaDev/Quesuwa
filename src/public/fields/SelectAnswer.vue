<script setup>
import { computed } from 'vue';
import { t } from '../../i18n.js';
import { shuffled } from './shuffle.js';

const props = defineProps({ field: Object, state: Object, seed: String, disabled: Boolean, describedBy: String, invalid: Boolean });
const options = computed(() => props.field.shuffle ? shuffled(props.field.options, props.seed + props.field.id) : props.field.options);
const value = computed({
  get: () => props.state.answers[props.field.id] ?? '',
  set: next => { props.state.answers[props.field.id] = next; }
});
</script>

<template>
  <select :id="'q-' + field.id" v-model="value" class="input select" :class="{ placeholder: !value }" :disabled="disabled" :aria-describedby="describedBy" :aria-invalid="invalid" :aria-required="field.required">
    <option value="" :disabled="field.required">{{ t('form.select') }}</option>
    <option v-for="option in options" :key="option" :value="option">{{ option }}</option>
  </select>
</template>
