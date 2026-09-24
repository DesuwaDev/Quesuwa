import { ref, watch } from 'vue';
import { defaultLocale, normalizeLocale, negotiateLocale, translate, catalogs } from '../i18n/core.js';
import { storage } from './lib/storage.js';

function initialLocale() {
  const saved = normalizeLocale(storage.get('quesuwa.locale'));
  if (saved) return saved;
  return negotiateLocale(navigator.languages?.join(',') || navigator.language, defaultLocale);
}

export const locale = ref(initialLocale());
export const t = (key, params) => translate(locale.value, key, params);
export const hasKey = key => typeof key === 'string' && Object.hasOwn(catalogs[locale.value], key);

export function setLocale(value) {
  const next = normalizeLocale(value);
  if (!next || next === locale.value) return;
  if (globalThis.document?.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(() => { locale.value = next; });
  } else locale.value = next;
}

watch(locale, value => {
  document.documentElement.lang = value;
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  storage.set('quesuwa.locale', value);
}, { immediate: true });

export const languageHeaders = () => ({ 'Accept-Language': locale.value });

export function apiError(data, fallback) {
  const code = typeof data?.code === 'string' && Object.hasOwn(catalogs[locale.value], data.code) ? data.code : fallback;
  return Object.assign(new Error(code), { code, params: data?.params || {} });
}

export const displayError = error => error ? t(error.code || 'errors.network', error.params || {}) : '';
