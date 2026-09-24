<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';

const props = defineProps({ value: { type: String, default: '' } });
// Rough estimate: length dominates, character variety adds a little.
const score = computed(() => {
  const value = props.value;
  if (!value) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(value)).length;
  if (value.length < 12) return 1;
  if (value.length >= 20 || (value.length >= 14 && variety >= 3)) return 3;
  return variety >= 2 ? 2 : 1;
});
const label = computed(() => ['', 'password.weak', 'password.fair', 'password.strong'][score.value]);
</script>

<template>
  <span v-if="value" class="password-strength" :class="'score-' + score">
    <span class="strength-bars" aria-hidden="true"><i></i><i></i><i></i></span>
    <small>{{ t(label) }}</small>
  </span>
</template>
