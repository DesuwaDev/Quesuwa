import zhCN from './locales/zh-CN.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };
export const catalogs = { 'zh-CN': zhCN, en };
export const supportedLocales = Object.keys(catalogs);
export const defaultLocale = 'zh-CN';
export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const language = value.trim().toLowerCase().replaceAll('_', '-');
  if (language === 'zh' || language.startsWith('zh-')) return 'zh-CN';
  if (language === 'en' || language.startsWith('en-')) return 'en';
  return null;
}
export function negotiateLocale(header, fallback = defaultLocale) {
  const preferences = String(header || '').split(',').map((part, index) => {
    const [tag, ...parameters] = part.trim().split(';');
    const quality = parameters.find(p => p.trim().startsWith('q='));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return { locale: normalizeLocale(tag), q, index };
  }).filter(p => p.locale && Number.isFinite(p.q) && p.q > 0 && p.q <= 1).sort((a, b) => b.q - a.q || a.index - b.index);
  return preferences[0]?.locale || normalizeLocale(fallback) || defaultLocale;
}
export function translate(locale, key, params = {}) {
  const catalog = catalogs[normalizeLocale(locale) || defaultLocale];
  if (!Object.hasOwn(catalog, key)) throw new Error(`Unknown translation key: ${key}`);
  // Optional singular variant: "<key>.one" is used when params.count is exactly 1.
  const template = Number(params.count) === 1 && Object.hasOwn(catalog, key + '.one') ? catalog[key + '.one'] : catalog[key];
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (!Object.hasOwn(params, name)) throw new Error(`Missing translation parameter: ${key}.${name}`);
    return String(params[name]);
  });
}
