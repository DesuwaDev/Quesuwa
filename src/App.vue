<script setup>
import { t, languageHeaders, apiError, displayError } from './i18n.js';
import { computed, onMounted, ref } from 'vue';
import Questionnaire from './Questionnaire.vue';
import LanguageSwitcher from './LanguageSwitcher.vue';
import Admin from './Admin.vue';
const admin = window.location.pathname.replace(/\/$/, '') === '/admin';
const slug = /^\/f\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
const form = ref(null), forms = ref([]), loading = ref(true), error = ref(''), success = ref(null);
function onSubmitted(data) { success.value = data; window.scrollTo(0, 0); }
const submittedId = computed(() => success.value?.id?.slice(0, 8).toUpperCase());
onMounted(async () => {
  if (admin) return;
  try {
    const response = await fetch(slug ? `/api/forms/${slug}` : '/api/forms', { headers: languageHeaders() });
    const data = await response.json();
    if (!response.ok) throw apiError(data, 'errors.page');
    if (slug) form.value = data; else forms.value = data;
  } catch (e) { error.value = e; } finally { loading.value = false; }
});
</script>
<template>
  <Admin v-if="admin" />
  <div v-else class="public-shell">
    <header class="public-header"><a class="brand" href="/"><span class="brand-mark">{{ t('app.mark') }}</span><span>{{ t('app.brand') }}<span class="brand-divider">/</span><span class="brand-sub">{{ t('public.subtitle') }}</span></span></a><span class="header-caption">{{ t('public.tagline') }}</span><LanguageSwitcher /></header>
    <main class="public-main">
      <div v-if="loading" class="state-card">{{ t('public.loading') }}</div>
      <div v-else-if="error" class="state-card"><span class="state-icon">—</span><h1>{{ t('public.unavailable') }}</h1><p>{{ displayError(error) }}</p><a class="button" href="/">{{ t('public.backHome') }}</a></div>
      <div v-else-if="success" class="state-card success-card" role="status"><span class="state-icon success-icon">✓</span><div class="eyebrow">{{ t('public.delivered') }}</div><h1>{{ t('public.thankYou') }}</h1><p class="preserve">{{ success.thanksKey ? t(success.thanksKey) : success.thanks }}</p><div class="receipt">{{ t('csv.id') }}<strong>{{ submittedId }}</strong><small>{{ t('public.receiptHint') }}</small></div><a href="/" class="button">{{ t('public.backSurveys') }}</a></div>
      <Questionnaire v-else-if="form" :form="form" @submitted="onSubmitted" />
      <div v-else>
        <div class="form-intro"><div class="eyebrow"><span class="live-dot"></span>{{ t('public.openSurveys') }}</div><h1>{{ t('public.heading') }}</h1><p class="intro-copy">{{ t('public.intro') }}</p></div>
        <div v-if="!forms.length" class="state-card"><p>{{ t('public.empty') }}</p></div>
        <a v-for="item in forms" :key="item.id" class="survey-link" :href="`/f/${item.slug}`"><div><span class="eyebrow">{{ t('public.summary', { count: item.fieldCount }) }}</span><h2>{{ item.title }}</h2><p>{{ item.description }}</p></div><span class="survey-arrow">↗</span></a>
      </div>
    </main>
    <footer class="public-footer"><span>{{ t('public.footer') }}</span><a href="/admin">{{ t('public.admin') }}</a></footer>
  </div>
</template>
