<script setup>
import AppIcon from './AppIcon.vue';
defineProps({ icon: { type: String, default: 'inbox' }, title: String, text: String, compact: Boolean });
</script>

<template>
  <div class="empty-state" :class="{ compact }">
    <span class="empty-icon"><AppIcon :name="icon" :size="compact ? 20 : 26" /></span>
    <h3 v-if="title">{{ title }}</h3>
    <p v-if="text">{{ text }}</p>
    <div v-if="$slots.default" class="empty-actions"><slot /></div>
  </div>
</template>
