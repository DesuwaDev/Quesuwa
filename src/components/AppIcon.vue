<script setup>
import { computed } from 'vue';
import { icons } from './icons.js';
const props = defineProps({ name: { type: String, required: true }, size: { type: [Number, String], default: 18 }, filled: Boolean });
const path = computed(() => icons[props.name] || icons.circle);
</script>

<template>
  <svg class="icon" :width="size" :height="size" viewBox="0 0 24 24" :fill="filled ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="path" /></svg>
</template>
