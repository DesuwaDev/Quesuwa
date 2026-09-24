<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({ page: { type: Number, required: true }, total: { type: Number, required: true }, pageSize: { type: Number, required: true }, disabled: Boolean });
const emit = defineEmits(['change']);
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const go = value => { if (value >= 1 && value <= pages.value && value !== props.page) emit('change', value); };
</script>

<template>
  <nav v-if="pages > 1" class="pagination" :aria-label="t('common.pagination')">
    <button type="button" class="icon-button" :disabled="disabled || page <= 1" :aria-label="t('common.previous')" @click="go(page - 1)"><AppIcon name="chevronLeft" /></button>
    <span class="pagination-status">{{ t('common.pageOf', { page, pages }) }}</span>
    <button type="button" class="icon-button" :disabled="disabled || page >= pages" :aria-label="t('common.next')" @click="go(page + 1)"><AppIcon name="chevronRight" /></button>
  </nav>
</template>
