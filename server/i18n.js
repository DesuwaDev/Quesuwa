import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultLocale, normalizeLocale, negotiateLocale, translate } from '../i18n/core.js';
export const requestLanguage = new AsyncLocalStorage();
const state = { locale: normalizeLocale(process.env.DEFAULT_LOCALE) || defaultLocale };
export const setServerLocale = value => { state.locale = normalizeLocale(value) || state.locale; };
export const t = (key, params) => translate(requestLanguage.getStore() || state.locale, key, params);
export function localeMiddleware(req, res, next) {
  const language = normalizeLocale(req.query.lang) || negotiateLocale(req.get('accept-language'), state.locale);
  res.set('Content-Language', language);
  res.vary('Accept-Language');
  requestLanguage.run(language, next);
}
