<script setup>
import { locale, t, setLocale, themeMode, setTheme, isSystemDark } from './i18n.js';

function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN');
}

function cycleTheme() {
  const dark = isSystemDark();
  if (themeMode.value === 'auto') {
    setTheme(dark ? 'light' : 'dark');
  } else if (themeMode.value === (dark ? 'light' : 'dark')) {
    setTheme(dark ? 'dark' : 'light');
  } else {
    setTheme('auto');
  }
}
</script>

<template>
  <div class="system-controls">
    <!-- Quick Cycle Theme Toggle Button -->
    <button
      type="button"
      class="control-btn theme-toggle-btn"
      :aria-label="t('theme.mode')"
      @click="cycleTheme"
    >
      <span class="control-icon" v-if="themeMode === 'light'">☀️</span>
      <span class="control-icon" v-else-if="themeMode === 'dark'">🌙</span>
      <span class="control-icon" v-else>💻</span>
      <span class="control-label">
        {{ themeMode === 'light' ? t('theme.light') : themeMode === 'dark' ? t('theme.dark') : t('theme.auto') }}
      </span>
    </button>

    <!-- Quick Language Toggle Button -->
    <button
      type="button"
      class="control-btn locale-toggle-btn"
      :aria-label="t('language.switch')"
      @click="toggleLocale"
    >
      <span class="control-icon">🌐</span>
      <span class="control-label">{{ locale === 'zh-CN' ? t('language.zhCN') : t('language.en') }}</span>
    </button>
  </div>
</template>
