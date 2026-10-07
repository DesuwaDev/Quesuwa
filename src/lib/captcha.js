// Browser side of human verification: loads a provider's widget and hands back tokens.
// Each mount returns { reset, execute?, dispose }; a channel that cannot load throws
// CaptchaUnavailable so the form can switch to the backup channel.
import { themeMode, isSystemDark } from './theme.js';

export class CaptchaUnavailable extends Error {}

const LOAD_TIMEOUT_MS = 10_000;
const scripts = new Map();

// Loads the first reachable URL; ready() decides when the provider's global is usable.
function loadScript(urls, ready) {
  const key = urls.join(' ');
  if (!scripts.has(key)) {
    scripts.set(key, (async () => {
      for (const url of urls) {
        if (ready()) return;
        const loaded = await new Promise(resolve => {
          const script = Object.assign(document.createElement('script'), { src: url, async: true });
          const timer = setTimeout(() => resolve(false), LOAD_TIMEOUT_MS);
          script.onload = () => { clearTimeout(timer); resolve(true); };
          script.onerror = () => { clearTimeout(timer); script.remove(); resolve(false); };
          document.head.append(script);
        });
        // Some providers finish setting up their global shortly after the script runs.
        for (let wait = 0; loaded && !ready() && wait < 50; wait++) await new Promise(resolve => setTimeout(resolve, 100));
        if (ready()) return;
      }
      throw new CaptchaUnavailable();
    })().catch(error => { scripts.delete(key); throw error; }));
  }
  return scripts.get(key);
}

const dark = theme => theme === 'dark' || (theme === 'auto' && (themeMode.value === 'dark' || (themeMode.value === 'auto' && isSystemDark())));
const language = locale => locale === 'zh-CN' ? 'zh-CN' : 'en';

async function mountTurnstile(host, channel, options) {
  await loadScript(['https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'], () => window.turnstile?.render);
  const id = window.turnstile.render(host, {
    sitekey: channel.siteKey, theme: options.theme, size: options.size, language: options.locale.toLowerCase(),
    callback: options.onToken, 'expired-callback': () => options.onToken(''), 'error-callback': () => options.onToken(''), 'timeout-callback': () => options.onToken('')
  });
  return { reset: () => window.turnstile.reset(id), dispose: () => { try { window.turnstile.remove(id); } catch { /* Already gone. */ } } };
}

async function mountHcaptcha(host, channel, options) {
  await loadScript([`https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off&hl=${language(options.locale)}`], () => window.hcaptcha?.render);
  const id = window.hcaptcha.render(host, {
    sitekey: channel.siteKey, theme: dark(options.theme) ? 'dark' : 'light', size: options.size,
    callback: options.onToken, 'expired-callback': () => options.onToken(''), 'chalexpired-callback': () => options.onToken(''), 'error-callback': () => options.onToken('')
  });
  return { reset: () => window.hcaptcha.reset(id), dispose: () => { try { window.hcaptcha.remove(id); } catch { /* Already gone. */ } } };
}

const grecaptchaReady = () => new Promise(resolve => window.grecaptcha.ready(resolve));

async function mountRecaptcha(host, channel, options) {
  await loadScript(channel.origins.map(origin => `${origin}/recaptcha/api.js?render=explicit&hl=${language(options.locale)}`), () => window.grecaptcha?.render);
  await grecaptchaReady();
  const target = document.createElement('div');
  host.replaceChildren(target);
  const id = window.grecaptcha.render(target, {
    sitekey: channel.siteKey, theme: dark(options.theme) ? 'dark' : 'light', size: options.size,
    callback: options.onToken, 'expired-callback': () => options.onToken(''), 'error-callback': () => options.onToken('')
  });
  return { reset: () => window.grecaptcha.reset(id), dispose: () => host.replaceChildren() };
}

// reCAPTCHA v3 has no widget: a token is minted for the "submit" action when the form is sent.
async function mountRecaptchaV3(host, channel, options) {
  await loadScript(channel.origins.map(origin => `${origin}/recaptcha/api.js?render=${encodeURIComponent(channel.siteKey)}&hl=${language(options.locale)}`), () => window.grecaptcha?.execute);
  await grecaptchaReady();
  options.onToken('');
  return { reset: () => {}, dispose: () => {}, execute: () => window.grecaptcha.execute(channel.siteKey, { action: 'submit' }) };
}

// Cap failures are classified before the widget folds them into one "network_error":
//   blocked     – 401/403/429/451 or an answer that says the visitor is blocked,
//   network     – timeouts, CORS, resets or an unreadable answer (the cause cannot be told),
//   unavailable – server errors, or the solver itself could not start.
export function capFailure(status, body) {
  if ([401, 403, 429, 451].includes(status)) return 'blocked';
  if (status >= 500) return 'unavailable';
  if (body && typeof body === 'object') {
    const message = [body.code, body.error, body.message].filter(value => typeof value === 'string').join(' ');
    if (/\b(blocked|forbidden|access[ _-]denied|country[ _-](blocked|restricted)|geo[ _-]blocked|rate[ _-]limit(?:ed|[ _-]exceeded)?)\b/i.test(message)) return 'blocked';
  }
  return status >= 400 ? 'unavailable' : null;
}

// Every Cap request goes through here so its outcome reaches the widget that made it.
const capListeners = new Map();
function capFetch(input, init) {
  const url = input instanceof Request ? input.url : String(input);
  const listener = capListeners.get(new URL(url, location.href).href);
  if (!listener) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), listener.timeout);
  let reported = false;
  const report = kind => { if (!reported) { reported = true; listener.failed(kind); } };
  return (async () => {
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { report('network'); }
      const failure = capFailure(response.status, body);
      if (failure) report(failure);
      return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      report('network');
      throw error;
    } finally { clearTimeout(timer); }
  })();
}

// Cap's widget and solver ship with Quesuwa; nothing is loaded from a CDN.
const CAP_UNAVAILABLE = ['missing_endpoint', 'challenge_unsupported', 'wasm_load_failed', 'worker_spawn_failed'];
async function mountCap(host, channel, options) {
  const { default: wasmUrl } = await import('@cap.js/wasm/browser/cap_wasm_bg.wasm?url');
  window.CAP_CUSTOM_WASM_URL = wasmUrl;
  window.CAP_CUSTOM_FETCH = capFetch;
  // Lets the browser check a self-hosted Cap server may send run under the page's CSP.
  const nonce = document.querySelector('meta[name="cap-nonce"]')?.content;
  if (nonce) window.CAP_SCRIPT_NONCE = nonce;
  await import('@cap.js/widget');
  const widget = document.createElement('cap-widget');
  const endpoint = new URL(channel.endpoint, location.href).href;
  widget.setAttribute('data-cap-api-endpoint', endpoint);
  widget.setAttribute('data-cap-hidden-field-name', 'captcha-token');
  if (channel.workerCount && channel.workerCount !== 'auto') widget.setAttribute('data-cap-worker-count', channel.workerCount);
  widget.setAttribute('data-cap-disable-haptics', '');
  for (const [key, label] of Object.entries(options.labels)) widget.setAttribute(`data-cap-i18n-${key}`, label);
  widget.classList.add('cap-box');
  if (options.size === 'compact') widget.classList.add('compact');
  let settled = false;
  const failed = kind => { if (!settled) { settled = true; options.onToken(''); options.onUnavailable(kind); } };
  const listener = { timeout: (channel.timeout || 10) * 1000, failed };
  const urls = ['challenge', 'redeem'].map(path => endpoint + path);
  for (const url of urls) capListeners.set(url, listener);
  // The widget's click handler ignores solve()'s promise; keep a refused request from becoming an unhandled error.
  const solve = widget.solve.bind(widget);
  widget.solve = () => solve().catch(() => { options.onToken(''); return { success: false, token: '' }; });
  widget.addEventListener('solve', event => options.onToken(event.detail.token));
  widget.addEventListener('reset', () => options.onToken(''));
  widget.addEventListener('error', event => {
    options.onToken('');
    const code = event.detail?.code;
    if (CAP_UNAVAILABLE.includes(code)) failed('unavailable');
    else if (['network_error', 'challenge_parse_error', 'instr_timeout'].includes(code)) failed('network');
    else if (code === 'instr_blocked') failed('blocked');
  });
  host.replaceChildren(widget);
  return {
    reset: () => { settled = false; widget.reset(); },
    dispose: () => { for (const url of urls) if (capListeners.get(url) === listener) capListeners.delete(url); widget.remove(); }
  };
}

const MOUNTS = { turnstile: mountTurnstile, hcaptcha: mountHcaptcha, recaptcha: mountRecaptcha, recaptchaV3: mountRecaptchaV3, cap: mountCap };

export async function mountCaptcha(host, channel, options) {
  const mount = MOUNTS[channel.provider];
  if (!mount) throw new CaptchaUnavailable();
  try { return await mount(host, channel, options); }
  catch (error) { throw error instanceof CaptchaUnavailable ? error : new CaptchaUnavailable(error?.message); }
}
