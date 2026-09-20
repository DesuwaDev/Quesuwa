<script setup>
import { locale, t, setLocale } from './i18n.js';
</script>
<template>
  <select class="language-switch" :aria-label="t('language.switch')" :value="locale" @change="setLocale($event.target.value)">
    <option value="zh-CN">{{ t('language.zhCN') }}</option>
    <option value="en">{{ t('language.en') }}</option>
  </select>
</template>
