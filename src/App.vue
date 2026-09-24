<script setup>
import { computed, defineAsyncComponent } from 'vue';
import { route } from './lib/router.js';
import PublicApp from './public/PublicApp.vue';
import FeedbackHost from './components/FeedbackHost.vue';

// The workspace is loaded on demand so respondents only download the questionnaire UI.
const AdminApp = defineAsyncComponent(() => import('./admin/AdminApp.vue'));
const isAdmin = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'));
</script>

<template>
  <AdminApp v-if="isAdmin" />
  <PublicApp v-else />
  <FeedbackHost />
</template>
