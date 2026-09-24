<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '../i18n.js';
import { api } from '../lib/api.js';
import { navigate, linkHandler } from '../lib/router.js';
import { formatDate, shortId } from '../lib/format.js';
import AppIcon from '../components/AppIcon.vue';
import EmptyState from '../components/EmptyState.vue';
import PaginationBar from '../components/PaginationBar.vue';
import { savedTickets } from '../lib/tickets.js';

const forms = ref([]), loading = ref(true), failed = ref(false), direct = ref(''), search = ref(''), page = ref(1);
const pageSize = 9;
const myTickets = ref(savedTickets());
const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  return term ? forms.value.filter(form => (form.title + ' ' + form.description).toLocaleLowerCase().includes(term)) : forms.value;
});
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
watch(search, () => { page.value = 1; });

onMounted(async () => {
  try { forms.value = await api('/forms'); }
  catch { failed.value = true; }
  finally { loading.value = false; }
});

function openDirect() {
  const raw = direct.value.trim();
  if (!raw) return;
  const target = /\/f\/([^/?#\s]+)/.exec(raw)?.[1] || raw.replace(/^\/+|\/+$/g, '');
  navigate('/f/' + encodeURIComponent(target));
}
</script>

<template>
  <div class="portal">
    <section class="portal-hero">
      <span class="eyebrow">{{ t('portal.eyebrow') }}</span>
      <h1>{{ t('portal.title') }}</h1>
      <p class="lead">{{ t('portal.intro') }}</p>
      <form class="direct-entry" @submit.prevent="openDirect">
        <label class="direct-input">
          <AppIcon name="link" :size="18" />
          <input v-model="direct" :placeholder="t('portal.directPlaceholder')" :aria-label="t('portal.directLabel')" autocomplete="off" />
        </label>
        <button class="button primary" type="submit" :disabled="!direct.trim()">{{ t('portal.directGo') }}<AppIcon name="arrowRight" :size="16" /></button>
      </form>
      <ul class="portal-points">
        <li><AppIcon name="shield" :size="16" />{{ t('portal.pointAnonymous') }}</li>
        <li><AppIcon name="phone" :size="16" />{{ t('portal.pointDevices') }}</li>
        <li><AppIcon name="clock" :size="16" />{{ t('portal.pointDraft') }}</li>
      </ul>
    </section>

    <section v-if="myTickets.length" class="portal-list">
      <div class="section-heading"><h2>{{ t('ticket.mine') }}</h2></div>
      <div class="ticket-links">
        <a v-for="item in myTickets" :key="item.id" class="ticket-link" :href="'/t/' + item.id + '#k=' + encodeURIComponent(item.key)" @click="linkHandler('/t/' + item.id + '#k=' + encodeURIComponent(item.key))($event)">
          <AppIcon name="message" :size="16" />
          <span class="clamp-1">{{ item.title || t('common.untitled') }}</span>
          <span class="mono muted small">#{{ shortId(item.id) }}</span>
          <time class="muted small">{{ formatDate(item.createdAt, { time: false }) }}</time>
        </a>
      </div>
    </section>

    <section class="portal-list" :aria-busy="loading">
      <div class="section-heading">
        <h2>{{ t('portal.openForms') }}</h2>
        <label v-if="forms.length > 6" class="search-input">
          <AppIcon name="search" :size="16" />
          <input v-model="search" type="search" :placeholder="t('portal.search')" :aria-label="t('portal.search')" />
        </label>
      </div>
      <div v-if="loading" class="card-grid">
        <div v-for="index in 3" :key="index" class="skeleton-card"></div>
      </div>
      <EmptyState v-else-if="failed" icon="alert" :title="t('errors.page')" compact />
      <EmptyState v-else-if="!filtered.length" icon="forms" :title="forms.length ? t('portal.noMatch') : t('portal.empty')" :text="forms.length ? '' : t('portal.emptyHint')" compact />
      <div v-else class="card-grid">
        <a v-for="form in visible" :key="form.id" class="portal-card" :class="'accent-' + form.accent" :href="'/f/' + form.slug" @click="linkHandler('/f/' + form.slug)($event)">
          <span class="portal-card-strip"></span>
          <h3>{{ form.title }}</h3>
          <p v-if="form.description" class="clamp-3">{{ form.description }}</p>
          <div class="portal-card-meta">
            <span><AppIcon name="forms" :size="14" />{{ t('common.questions', { count: form.questionCount }) }}</span>
            <span v-if="form.endsAt"><AppIcon name="clock" :size="14" />{{ t('portal.endsAt', { date: formatDate(form.endsAt) }) }}</span>
            <span v-if="form.protected"><AppIcon name="lock" :size="14" />{{ t('portal.protected') }}</span>
          </div>
        </a>
      </div>
      <PaginationBar :page="page" :total="filtered.length" :page-size="pageSize" @change="page = $event" />
    </section>
  </div>
</template>
