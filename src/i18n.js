import { ref, watch, nextTick } from 'vue';
import { defaultLocale, normalizeLocale, negotiateLocale, translate, catalogs } from '../i18n/core.js';

function initialLocale() {
  try { const saved = normalizeLocale(localStorage.getItem('quesuwa.locale')); if (saved) return saved; } catch { /* Storage may be disabled. */ }
  return negotiateLocale(navigator.languages?.join(',') || navigator.language, defaultLocale);
}

export const locale = ref(initialLocale());
export const t = (key, params) => translate(locale.value, key, params);

export async function transitionView(callback) {
  const result = await callback?.();
  await nextTick();
  return result;
}

export function setLocale(value) {
  const next = normalizeLocale(value);
  if (next && next !== locale.value) {
    if (globalThis.document?.startViewTransition) {
      document.startViewTransition(async () => {
        locale.value = next;
        await nextTick();
      });
    } else {
      locale.value = next;
    }
  }
}

watch(locale, value => {
  document.documentElement.lang = value;
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  try { localStorage.setItem('quesuwa.locale', value); } catch { /* Storage may be disabled. */ }
}, { immediate: true });

function initialTheme() {
  try {
    const saved = localStorage.getItem('quesuwa.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
  } catch { /* Storage may be disabled. */ }
  return 'auto';
}

export const themeMode = ref(initialTheme());

export const isSystemDark = () => Boolean(globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches);

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
  } else {
    document.documentElement.setAttribute('data-theme', isSystemDark() ? 'dark' : 'light');
  }
}

export function setTheme(mode) {
  if (mode === 'light' || mode === 'dark' || mode === 'auto') {
    if (globalThis.document?.startViewTransition) {
      document.documentElement.classList.add('theme-transitioning');
      const transition = document.startViewTransition(async () => {
        themeMode.value = mode;
        applyTheme(mode);
        await nextTick();
      });
      transition.finished.finally(() => {
        document.documentElement.classList.remove('theme-transitioning');
      });
    } else {
      themeMode.value = mode;
      applyTheme(mode);
    }
    try { localStorage.setItem('quesuwa.theme', mode); } catch { /* Storage may be disabled. */ }
  }
}

applyTheme(themeMode.value);

if (globalThis.window?.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeMode.value === 'auto') {
      transitionView(() => {
        applyTheme('auto');
      });
    }
  });
}

export const languageHeaders = () => ({ 'Accept-Language': locale.value });

export function apiError(data, fallback) {
  const code = typeof data?.code === 'string' && Object.hasOwn(catalogs[locale.value], data.code) ? data.code : fallback;
  return Object.assign(new Error(code), { code, params: data?.params || {} });
}

export const displayError = error => error ? t(error.code || 'errors.network', error.params || {}) : '';
