import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { defaultLocale, normalizeLocale, translate } from './i18n/core.js';
import packageInfo from './package.json' with { type: 'json' };

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const language = normalizeLocale(env.DEFAULT_LOCALE) || defaultLocale;
  // Release images pass APP_VERSION from the git tag; local builds fall back to package.json.
  const version = (process.env.APP_VERSION || env.APP_VERSION || packageInfo.version).replace(/^v/, '') + (command === 'serve' ? '-dev' : '');
  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [vue(), {
      name: 'localized-html',
      transformIndexHtml: html => html.replace('%QUESUWA_LOCALE%', language)
        .replace('%QUESUWA_TITLE%', translate(language, 'app.title'))
        .replace('%QUESUWA_DESCRIPTION%', translate(language, 'app.description'))
    }],
    server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3100' } }
  };
});
