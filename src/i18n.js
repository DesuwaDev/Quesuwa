import { ref, watch } from 'vue';
import { defaultLocale, normalizeLocale, negotiateLocale, translate, catalogs } from '../i18n/core.js';
function initialLocale() {
  try { const saved = normalizeLocale(localStorage.getItem('quesuwa.locale')); if (saved) return saved; } catch { /* Storage may be disabled. */ }
  return negotiateLocale(navigator.languages?.join(',') || navigator.language, defaultLocale);
}
export const locale = ref(initialLocale());
export const t = (key, params) => translate(locale.value, key, params);
export function setLocale(value) { const next = normalizeLocale(value); if (next) locale.value = next; }
watch(locale, value => {
  document.documentElement.lang = value;
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  try { localStorage.setItem('quesuwa.locale', value); } catch { /* Storage may be disabled. */ }
}, { immediate: true });
export const languageHeaders = () => ({ 'Accept-Language': locale.value });
export function apiError(data, fallback) {
  const code = typeof data?.code === 'string' && Object.hasOwn(catalogs[locale.value], data.code) ? data.code : fallback;
  return Object.assign(new Error(code), { code, params: data?.params || {} });
}
export const displayError = error => error ? t(error.code || 'errors.network', error.params || {}) : '';
