import { ref } from 'vue';
import { storage } from './storage.js';

const modes = ['light', 'dark', 'auto'];
const saved = storage.get('quesuwa.theme');
export const themeMode = ref(modes.includes(saved) ? saved : 'auto');

const media = globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)');
export const isSystemDark = () => Boolean(media?.matches);

function apply(mode) {
  const dark = mode === 'dark' || (mode === 'auto' && isSystemDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1F1A19' : '#F4EDE8');
}

export function setTheme(mode) {
  if (!modes.includes(mode)) return;
  const change = () => { themeMode.value = mode; apply(mode); };
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(change);
  else change();
  storage.set('quesuwa.theme', mode);
}

// Cycles system → light → dark.
export function cycleTheme() {
  setTheme(modes[(modes.indexOf(themeMode.value) + 2) % modes.length]);
}

apply(themeMode.value);
media?.addEventListener('change', () => { if (themeMode.value === 'auto') apply('auto'); });
