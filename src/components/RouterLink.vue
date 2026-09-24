<script setup>
import { computed } from 'vue';
import { route, linkHandler } from '../lib/router.js';
const props = defineProps({ to: { type: String, required: true }, exact: Boolean });
const active = computed(() => {
  const path = props.to.split('?')[0];
  return props.exact ? route.path === path : route.path === path || route.path.startsWith(path + '/');
});
</script>

<template>
  <a :href="to" :class="{ active }" :aria-current="active ? 'page' : undefined" @click="linkHandler(to)($event)"><slot /></a>
</template>
