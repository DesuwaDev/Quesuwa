import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultLocale, normalizeLocale, negotiateLocale, translate } from '../i18n/core.js';
export const requestLanguage = new AsyncLocalStorage();
export const serverLocale = normalizeLocale(process.env.DEFAULT_LOCALE) || defaultLocale;
export const t = (key, params) => translate(requestLanguage.getStore() || serverLocale, key, params);
export function localeMiddleware(req, res, next) {
  const language = normalizeLocale(req.query.lang) || negotiateLocale(req.get('accept-language'), serverLocale);
  res.set('Content-Language', language);
  res.vary('Accept-Language');
  requestLanguage.run(language, next);
}
