<script setup>
import { t, languageHeaders, apiError, displayError, transitionView } from './i18n.js';
import { computed, onMounted, ref } from 'vue';
import Questionnaire from './Questionnaire.vue';
import LanguageSwitcher from './LanguageSwitcher.vue';
import Admin from './Admin.vue';

const currentPath = ref(window.location.pathname);
const admin = computed(() => currentPath.value.replace(/\/$/, '') === '/admin');
const slug = computed(() => /^\/f\/([^/]+)\/?$/.exec(currentPath.value)?.[1]);

const form = ref(null), loading = ref(Boolean(slug.value)), error = ref(''), success = ref(null);
const directInput = ref('');
const listedForms = ref([]);
const listedPage = ref(1);
const listedPageSize = ref(6);
const listedTotalPages = computed(() => Math.max(1, Math.ceil(listedForms.value.length / listedPageSize.value)));
const paginatedListedForms = computed(() => {
  const max = listedTotalPages.value;
  const cur = Math.min(Math.max(1, listedPage.value), max);
  const start = (cur - 1) * listedPageSize.value;
  return listedForms.value.slice(start, start + listedPageSize.value);
});
async function loadListed() {
  listedPage.value = 1;
  try { const response = await fetch('/api/forms', { headers: languageHeaders() }); if (response.ok) listedForms.value = await response.json(); } catch { listedForms.value = []; }
}

async function loadForm(targetSlug) {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch(`/api/forms/${targetSlug}`, { headers: languageHeaders() });
    const data = await response.json();
    if (!response.ok) throw apiError(data, 'errors.page');
    form.value = data;
  } catch (e) { error.value = e; } finally { loading.value = false; }
}

function navigate(path) {
  if (path === currentPath.value && !success.value) return;
  window.history.pushState({}, '', path);
  transitionView(async () => {
    currentPath.value = path;
    window.scrollTo(0, 0);
    success.value = null;
    error.value = '';
    if (slug.value) {
      await loadForm(slug.value);
    } else {
      form.value = null;
      loading.value = false;
      if (!admin.value) await loadListed();
    }
  });
}

function onSubmitted(data) {
  transitionView(() => {
    success.value = data;
    form.value = null;
    window.scrollTo(0, 0);
  });
}

function goDirect() {
  const raw = directInput.value.trim();
  if (!raw) return;
  const match = /\/f\/([^/?#]+)/.exec(raw);
  const target = match ? match[1] : raw;
  navigate(`/f/${encodeURIComponent(target)}`);
}

const submittedId = computed(() => success.value?.id?.slice(0, 8).toUpperCase());

onMounted(async () => {
  window.addEventListener('popstate', () => {
    if (currentPath.value === window.location.pathname) return;
    transitionView(async () => {
      currentPath.value = window.location.pathname;
      window.scrollTo(0, 0);
      success.value = null;
      error.value = '';
      if (slug.value) {
        await loadForm(slug.value);
      } else {
        form.value = null;
        loading.value = false;
      if (!admin.value) await loadListed();
      }
    });
  });

  if (!admin.value && !slug.value) await loadListed();
  if (admin.value || !slug.value) return;
  await loadForm(slug.value);
});
</script>

<template>
  <Admin v-if="admin" />
  <div
    v-else
    class="public-shell"
    :class="{
      'portal-mode': !slug && !form && !success && !error && !loading
    }"
  >
    <header class="public-header">
      <a class="brand" href="/" @click.prevent="navigate('/')">
        <img class="brand-mark" src="/logo.png" :alt="t('app.brand')" />
        <span>
          {{ t('app.brand') }}
          <span class="brand-divider">/</span>
          <span class="brand-sub">{{ t('public.subtitle') }}</span>
        </span>
      </a>
      <div class="header-tools">
        <button
          v-if="slug || form || success || error"
          type="button"
          class="control-btn header-back-btn"
          @click="navigate('/')"
        >
          ← {{ t('public.backHome') }}
        </button>
        <LanguageSwitcher />
      </div>
    </header>

    <main class="public-main">
      <!-- Loading State -->
      <div v-if="loading" class="state-card loading-card">
        <div class="spinner"></div>
        <p>{{ t('public.loading') }}</p>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="state-card error-card">
        <span class="state-icon">—</span>
        <h1>{{ t('public.unavailable') }}</h1>
        <p>{{ displayError(error) }}</p>
        <a class="button primary" href="/" @click.prevent="navigate('/')">{{ t('public.backHome') }}</a>
      </div>

      <!-- Success Receipt State -->
      <div v-else-if="success" class="state-card success-card" role="status">
        <span class="state-icon success-icon">✓</span>
        <div class="eyebrow">{{ t('public.delivered') }}</div>
        <h1>{{ t('public.thankYou') }}</h1>
        <p class="preserve">{{ success.thanksKey ? t(success.thanksKey) : success.thanks }}</p>
        <div class="receipt">
          <span>{{ t('csv.id') }}</span>
          <strong>{{ submittedId }}</strong>
          <small>{{ t('public.receiptHint') }}</small>
        </div>
        <a href="/" class="button primary" @click.prevent="navigate('/')">{{ t('public.backSurveys') }}</a>
      </div>

      <!-- Questionnaire View (When on /f/:slug) -->
      <Questionnaire v-else-if="form" :key="form.id" :form="form" @submitted="onSubmitted" />

      <!-- MINIMAL PORTAL ENTRANCE VIEW -->
      <div v-else class="portal-entrance minimal">
        <section class="portal-hero">
          <!-- Quick Access Direct Jump Bar -->
          <form class="portal-direct-bar" @submit.prevent="goDirect">
            <div class="direct-input-wrap">
              <span class="direct-icon">⚲</span>
              <input
                v-model="directInput"
                :placeholder="t('portal.directPlaceholder')"
                :aria-label="t('portal.directEnter')"
                autofocus
              />
            </div>
            <button class="button primary" type="submit" :disabled="!directInput.trim()">
              {{ t('portal.directGo') }}
            </button>
          </form>
        </section>
        <section v-if="listedForms.length" class="listed-surveys">
          <h2>{{ t('public.listed') }}</h2>
          <div class="form-grid">
            <a v-for="item in paginatedListedForms" :key="item.id" class="panel listed-survey" :href="`/f/${item.slug}`" @click.prevent="navigate(`/f/${item.slug}`)">
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
              <small>{{ t('common.questions', { count: item.fieldCount }) }}</small>
            </a>
          </div>
          <div v-if="listedForms.length > listedPageSize" class="pagination">
            <button class="button" :disabled="listedPage <= 1" @click="listedPage--">
              {{ t('responses.previous') }}
            </button>
            <span>{{ listedPage }} / {{ listedTotalPages }}</span>
            <button class="button" :disabled="listedPage >= listedTotalPages" @click="listedPage++">
              {{ t('responses.next') }}
            </button>
          </div>
        </section>
      </div>
    </main>

    <footer class="public-footer">
      <span>{{ t('public.footer') }}</span>
      <a href="/admin" @click.prevent="navigate('/admin')">{{ t('public.admin') }}</a>
    </footer>
  </div>
</template>
