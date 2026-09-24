<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { route, linkHandler } from '../lib/router.js';
import BrandMark from '../components/BrandMark.vue';
import SystemControls from '../components/SystemControls.vue';
import AppIcon from '../components/AppIcon.vue';
import PortalView from './PortalView.vue';
import FormPage from './FormPage.vue';
import EmptyState from '../components/EmptyState.vue';
import { appVersion } from '../lib/version.js';

const slug = computed(() => {
  const match = /^\/f\/([^/]+)$/.exec(route.path);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
});
const known = computed(() => route.path === '/' || Boolean(slug.value));
</script>

<template>
  <div class="public-shell">
    <header class="public-header">
      <BrandMark :subtitle="t('public.subtitle')" />
      <div class="header-tools">
        <a v-if="slug" class="button ghost small" href="/" @click="linkHandler('/')($event)"><AppIcon name="arrowLeft" :size="16" /><span class="hide-narrow">{{ t('public.backHome') }}</span></a>
        <SystemControls compact />
      </div>
    </header>
    <main class="public-main">
      <FormPage v-if="slug" :key="slug" :slug="slug" />
      <PortalView v-else-if="known" />
      <EmptyState v-else icon="alert" :title="t('public.notFound')" :text="t('public.notFoundHint')">
        <a class="button primary" href="/" @click="linkHandler('/')($event)">{{ t('public.backHome') }}</a>
      </EmptyState>
    </main>
    <footer class="public-footer">
      <span>{{ t('public.footer') }}</span>
      <a href="/admin" @click="linkHandler('/admin')($event)">{{ t('public.admin') }}</a>
      <span class="version-tag">{{ t('app.version', { version: appVersion }) }}</span>
    </footer>
  </div>
</template>
