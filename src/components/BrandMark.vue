<script setup>
import { t } from '../i18n.js';
import { linkHandler } from '../lib/router.js';
defineProps({ to: { type: String, default: '/' }, subtitle: String });
</script>

<template>
  <a class="brand" :href="to" @click="linkHandler(to)($event)">
    <img class="brand-mark" src="/favicon-64.png" width="32" height="32" :alt="t('app.brand')" />
    <span class="brand-text"><strong>{{ t('app.brand') }}</strong><span v-if="subtitle" class="brand-sub">{{ subtitle }}</span></span>
  </a>
</template>
