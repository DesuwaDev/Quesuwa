// Optional human verification before a questionnaire is submitted.
//
// Channels: Cap (built in, or a self-hosted Cap Standalone server), Cloudflare Turnstile,
// hCaptcha, and Google reCAPTCHA v2 / v3. Every submission's token is verified server-side.
//
// Backups: a general backup channel takes over when the primary cannot load. Cap failures are
// routed on their own, because a refusal means something different from a network problem:
//   blocked  – Cap answered 401/403/429/451 or said the visitor is blocked,
//   network  – CORS, timeouts, resets or garbled answers: the cause cannot be told,
// each with "fail, no backup" (default), "use the general backup", or a named channel.
// Only channels that some route can actually reach are accepted at submission.
import Cap from '@cap.js/server';
import { fail } from '../errors.js';

export const CAPTCHA_PROVIDERS = ['cap', 'turnstile', 'hcaptcha', 'recaptcha', 'recaptchaV3'];
const THEMES = ['auto', 'light', 'dark'];
const SIZES = ['normal', 'compact'];
const ENDPOINTS = ['auto', 'global', 'china'];
const WORKERS = ['auto', '1', '2', '4', '8'];
const TIMEOUTS = ['5', '10', '20', '30'];
const STRENGTH = { low: 25, medium: 50, high: 100 };
const VERIFY_TIMEOUT_MS = 8_000;

// reCAPTCHA is also served from recaptcha.net for networks that cannot reach google.com;
// both fronts share one backend, so a token from either verifies through either.
const RECAPTCHA = { global: 'https://www.google.com', china: 'https://www.recaptcha.net' };
const SITEVERIFY = {
  turnstile: ['https://challenges.cloudflare.com/turnstile/v0/siteverify'],
  hcaptcha: ['https://api.hcaptcha.com/siteverify']
};

const providerDefaults = () => ({
  cap: { mode: 'builtin', strength: 'medium', serverUrl: '', verificationServerUrl: '', siteKey: '', secret: '', workerCount: '2', timeout: '10' },
  turnstile: { siteKey: '', secret: '' },
  hcaptcha: { siteKey: '', secret: '' },
  recaptcha: { siteKey: '', secret: '', endpoint: 'auto' },
  recaptchaV3: { siteKey: '', secret: '', endpoint: 'auto', threshold: 0.5 }
});
const POLICIES = ['none', 'default', ...CAPTCHA_PROVIDERS.filter(id => id !== 'cap')];
const defaults = () => ({ provider: 'none', fallback: 'none', capBlockedFallback: 'none', capNetworkFallback: 'none', theme: 'auto', size: 'normal', providers: providerDefaults() });

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

// A Cap Standalone root such as https://cap.example.com (no credentials, query or fragment).
export function validServerUrl(value) {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
const capBase = (root, siteKey) => `${root.replace(/\/+$/, '')}/${encodeURIComponent(siteKey)}/`;
const recaptchaOrigins = endpoint => endpoint === 'auto' ? [RECAPTCHA.global, RECAPTCHA.china] : [RECAPTCHA[endpoint] || RECAPTCHA.global];

export function createCaptcha(db, { endpoints = {} } = {}) {
  const read = () => {
    const base = defaults();
    let stored = {};
    try { stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='captcha'").get()?.value || '{}'); } catch { stored = {}; }
    const providers = Object.fromEntries(CAPTCHA_PROVIDERS.map(id => [id, { ...base.providers[id], ...(stored.providers?.[id] || {}) }]));
    return { ...base, ...stored, providers };
  };
  let config = read();
  // Built-in Cap keeps challenges and tokens in memory; after a restart visitors simply solve again.
  const cap = new Cap({ noFSState: true });

  function ready(id) {
    const settings = config.providers[id];
    if (!settings) return false;
    if (id === 'cap') {
      if (settings.mode === 'builtin') return true;
      return Boolean(validServerUrl(settings.serverUrl) && settings.siteKey && settings.secret && (!settings.verificationServerUrl || validServerUrl(settings.verificationServerUrl)));
    }
    return Boolean(settings.siteKey && settings.secret);
  }
  const usable = id => id && id !== 'none' && ready(id) ? id : null;
  const primary = () => config.provider !== 'none' && ready(config.provider) ? config.provider : null;
  const generalFallback = () => primary() && config.fallback !== config.provider ? usable(config.fallback) : null;
  // Where the form goes when Cap fails in a particular way; Cap never stands in for itself.
  function capRoute(kind) {
    if (!primary() || (config.provider !== 'cap' && config.fallback !== 'cap')) return null;
    const policy = kind === 'blocked' ? config.capBlockedFallback : config.capNetworkFallback;
    const id = policy === 'default' ? generalFallback() : policy === 'none' ? null : usable(policy);
    return id && id !== 'cap' ? id : null;
  }
  // Every channel a visitor can legitimately end up on.
  const channels = () => primary() ? [...new Set([primary(), generalFallback(), capRoute('blocked'), capRoute('network')].filter(Boolean))] : [];

  // What the browser needs for one channel; secrets never leave the server.
  function channel(id) {
    if (!id) return null;
    const settings = config.providers[id];
    const result = { provider: id, siteKey: id === 'cap' ? '' : settings.siteKey };
    if (id === 'cap') Object.assign(result, {
      endpoint: settings.mode === 'builtin' ? '/api/captcha/cap/' : capBase(settings.serverUrl, settings.siteKey),
      workerCount: settings.workerCount, timeout: Number(settings.timeout)
    });
    if (id === 'recaptcha' || id === 'recaptchaV3') result.origins = recaptchaOrigins(settings.endpoint);
    return result;
  }
  // Null when verification is off or the primary channel is incomplete.
  function publicConfig() {
    if (!primary()) return null;
    return {
      theme: config.theme, size: config.size,
      primary: channel(primary()), fallback: channel(generalFallback()),
      capFallbacks: { blocked: channel(capRoute('blocked')), network: channel(capRoute('network')) }
    };
  }

  // The full settings, secrets included, for the owner's settings page.
  const view = () => ({ ...structuredClone(config), ready: Object.fromEntries(CAPTCHA_PROVIDERS.map(id => [id, ready(id)])), accepted: channels() });

  function update(input) {
    if (!input || typeof input !== 'object') throw fail(400, 'errors.captchaInvalid');
    const choices = [...CAPTCHA_PROVIDERS, 'none'];
    const provider = input.provider ?? config.provider;
    const fallback = input.fallback ?? config.fallback;
    if (!choices.includes(provider) || !choices.includes(fallback)) throw fail(400, 'errors.captchaInvalid');
    // Each channel keeps its own settings, so switching back and forth never loses keys.
    const providers = {};
    for (const id of CAPTCHA_PROVIDERS) {
      const current = config.providers[id];
      const given = input.providers?.[id] || {};
      const next = { ...current };
      if (given.siteKey !== undefined) next.siteKey = text(given.siteKey, 512);
      if (given.secret !== undefined) next.secret = text(given.secret, 512);
      if (id === 'cap') {
        next.mode = pick(given.mode ?? current.mode, ['builtin', 'standalone'], 'builtin');
        next.strength = pick(given.strength ?? current.strength, Object.keys(STRENGTH), 'medium');
        next.workerCount = pick(String(given.workerCount ?? current.workerCount), WORKERS, '2');
        next.timeout = pick(String(given.timeout ?? current.timeout), TIMEOUTS, '10');
        for (const key of ['serverUrl', 'verificationServerUrl']) {
          if (given[key] === undefined) continue;
          next[key] = text(given[key], 2048).replace(/\/+$/, '');
          if (next[key] && !validServerUrl(next[key])) throw fail(400, 'errors.captchaServerUrl');
        }
      }
      if (id === 'recaptcha' || id === 'recaptchaV3') next.endpoint = pick(given.endpoint ?? current.endpoint, ENDPOINTS, 'auto');
      if (id === 'recaptchaV3' && given.threshold !== undefined) {
        const threshold = Number(given.threshold);
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw fail(400, 'errors.captchaInvalid');
        next.threshold = Math.round(threshold * 100) / 100;
      }
      providers[id] = next;
    }
    const next = {
      provider, fallback: fallback === provider ? 'none' : fallback,
      capBlockedFallback: pick(input.capBlockedFallback ?? config.capBlockedFallback, POLICIES, 'none'),
      capNetworkFallback: pick(input.capNetworkFallback ?? config.capNetworkFallback, POLICIES, 'none'),
      theme: pick(input.theme ?? config.theme, THEMES, 'auto'), size: pick(input.size ?? config.size, SIZES, 'normal'), providers
    };
    const previous = config;
    config = next;
    // A channel that is switched on must be able to verify.
    for (const id of [next.provider, next.fallback]) {
      if (id !== 'none' && !ready(id)) { config = previous; throw fail(400, id === 'cap' ? 'errors.captchaCapServer' : 'errors.captchaKeys'); }
    }
    db.prepare("INSERT INTO settings(key, value) VALUES ('captcha', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
    return view();
  }

  // Built-in Cap endpoints used by the widget.
  const builtin = () => config.providers.cap.mode === 'builtin' && channels().includes('cap');
  const challenge = () => cap.createChallenge({ challengeCount: STRENGTH[config.providers.cap.strength] || STRENGTH.medium });
  const redeem = body => cap.redeemChallenge({ token: String(body?.token || ''), solutions: Array.isArray(body?.solutions) ? body.solutions : [] });

  // Candidate siteverify URLs; an unreachable one is skipped rather than treated as a rejection.
  function siteverifyUrls(id) {
    if (endpoints[id]) return [].concat(endpoints[id]);
    const settings = config.providers[id];
    if (id === 'cap') return [capBase(settings.verificationServerUrl || settings.serverUrl, settings.siteKey) + 'siteverify'];
    if (id === 'recaptcha' || id === 'recaptchaV3') return recaptchaOrigins(settings.endpoint).map(origin => origin + '/recaptcha/api/siteverify');
    return SITEVERIFY[id];
  }

  // True when the token is genuine for one of the accepted channels.
  async function verify(provider, token, remoteip = '') {
    if (!channels().includes(provider) || typeof token !== 'string' || !token || token.length > 8192) return false;
    const settings = config.providers[provider];
    if (provider === 'cap' && settings.mode === 'builtin') return (await cap.validateToken(token)).success === true;
    const fields = { secret: settings.secret, response: token };
    if (remoteip && provider !== 'cap') fields.remoteip = remoteip;
    if (provider === 'hcaptcha') fields.sitekey = settings.siteKey;
    const timeout = provider === 'cap' ? Number(settings.timeout) * 1000 : VERIFY_TIMEOUT_MS;
    let data = null, reached = false;
    for (const url of siteverifyUrls(provider)) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': provider === 'cap' ? 'application/json' : 'application/x-www-form-urlencoded' },
          body: provider === 'cap' ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
          redirect: 'error',
          signal: AbortSignal.timeout(timeout)
        });
        if (!response.ok) continue;
        data = await response.json();
        reached = true;
        break;
      } catch (error) { console.error('captcha siteverify unreachable', url, error?.message || error); }
    }
    // When no verification server answers at all, say so instead of blaming the visitor.
    if (!reached) throw fail(503, 'errors.captchaUnavailable');
    if (data?.success !== true) return false;
    // reCAPTCHA v3 always "succeeds"; the decision is the score and the action it was minted for.
    if (provider === 'recaptchaV3') return data.action === 'submit' && typeof data.score === 'number' && data.score >= settings.threshold;
    return true;
  }

  // Extra Content-Security-Policy sources the reachable widgets need.
  function sources(kind) {
    const list = new Set();
    for (const id of channels()) {
      const settings = config.providers[id];
      if (id === 'cap') {
        if (kind === 'script') list.add("'wasm-unsafe-eval'");
        if (kind === 'worker') list.add('blob:');
        if (kind === 'connect' && settings.mode === 'standalone') list.add(new URL(settings.serverUrl).origin);
      } else if (id === 'turnstile') {
        if (['script', 'frame', 'connect'].includes(kind)) list.add('https://challenges.cloudflare.com');
      } else if (id === 'hcaptcha') {
        if (['script', 'frame', 'connect', 'style'].includes(kind)) { list.add('https://hcaptcha.com'); list.add('https://*.hcaptcha.com'); }
      } else {
        for (const origin of recaptchaOrigins(settings.endpoint)) {
          if (['script', 'frame', 'connect'].includes(kind)) list.add(origin + '/recaptcha/');
          if (kind === 'frame' && origin === RECAPTCHA.global) list.add('https://recaptcha.google.com/recaptcha/');
          if (kind === 'script') {
            list.add('https://www.gstatic.com/recaptcha/');
            if (origin === RECAPTCHA.china) list.add('https://www.gstatic.cn/recaptcha/');
          }
        }
      }
    }
    return [...list].join(' ');
  }

  return { config: view, update, publicConfig, channels, builtin, challenge, redeem, verify, sources };
}
