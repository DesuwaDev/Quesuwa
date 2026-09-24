<script setup>
import { computed } from 'vue';
import { locale, t, setLocale } from '../i18n.js';
import { themeMode, cycleTheme } from '../lib/theme.js';
import AppIcon from './AppIcon.vue';

defineProps({ compact: Boolean });
const themeIcon = computed(() => ({ light: 'sun', dark: 'moon', auto: 'monitor' })[themeMode.value]);
const themeLabel = computed(() => t({ light: 'theme.light', dark: 'theme.dark', auto: 'theme.auto' }[themeMode.value]));
const toggleLocale = () => setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN');
</script>

<template>
  <div class="system-controls" :class="{ compact }">
    <button type="button" class="control-button" :title="t('theme.mode') + ' · ' + themeLabel" :aria-label="t('theme.mode') + ' · ' + themeLabel" @click="cycleTheme">
      <AppIcon :name="themeIcon" :size="16" /><span class="control-label">{{ themeLabel }}</span>
    </button>
    <button type="button" class="control-button" :title="t('language.switch')" :aria-label="t('language.switch')" @click="toggleLocale">
      <AppIcon name="globe" :size="16" /><span class="control-label">{{ locale === 'zh-CN' ? t('language.en') : t('language.zhCN') }}</span>
    </button>
  </div>
</template>
