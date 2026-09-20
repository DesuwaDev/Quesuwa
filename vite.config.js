import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { defaultLocale, normalizeLocale, translate } from './i18n/core.js';
export default defineConfig(({ mode }) => {
  const language = normalizeLocale(loadEnv(mode, process.cwd(), '').DEFAULT_LOCALE) || defaultLocale;
  return {
    plugins: [vue(), {
      name: 'localized-html',
      transformIndexHtml: html => html.replace('%QUESUWA_LOCALE%', language)
        .replace('%QUESUWA_TITLE%', translate(language, 'app.title'))
        .replace('%QUESUWA_DESCRIPTION%', translate(language, 'app.description')),
    }],
    server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3100' } },
  };
});
