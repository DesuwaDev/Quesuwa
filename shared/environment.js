// Diagnostic details a respondent's browser attaches when a questionnaire asks for them.
// The server keeps only these keys, trimmed to safe lengths.

const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const size = value => typeof value === 'string' && /^\d{1,5}x\d{1,5}$/.test(value) ? value : '';
const webUrl = value => /^https?:\/\/[^\s]+$/i.test(value) ? value : '';

export function cleanEnvironment(raw, fallbackAgent = '') {
  let input = raw;
  if (typeof raw === 'string') {
    try { input = raw.length <= 4000 ? JSON.parse(raw) : {}; } catch { input = {}; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const page = text(input.page, 500);
  return {
    userAgent: text(input.userAgent, 400) || text(fallbackAgent, 400),
    platform: text(input.platform, 40),
    mobile: input.mobile === true,
    touch: input.touch === true,
    screen: size(input.screen),
    viewport: size(input.viewport),
    pixelRatio: typeof input.pixelRatio === 'number' && input.pixelRatio > 0 && input.pixelRatio <= 10 ? Math.round(input.pixelRatio * 100) / 100 : null,
    language: text(input.language, 35),
    timeZone: text(input.timeZone, 64),
    colorScheme: ['dark', 'light'].includes(input.colorScheme) ? input.colorScheme : '',
    referrer: webUrl(text(input.referrer, 500)),
    page: page.startsWith('/') ? page : ''
  };
}

const version = (agent, pattern) => pattern.exec(agent)?.[1] || '';

// Browser and system names with major versions, e.g. "Chrome 128" and "Android 14".
export function parseAgent(agent = '') {
  const browsers = [
    ['WeChat', /MicroMessenger\/(\d+)/], ['QQ', /\bQQ\/(\d+)/], ['Quark', /Quark\/(\d+)/], ['UC', /UCBrowser\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/], ['Huawei', /HuaweiBrowser\/(\d+)/], ['MIUI', /MiuiBrowser\/(\d+)/],
    ['Edge', /Edg(?:A|iOS)?\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+(?:\.\d+)?).*Safari\//]
  ];
  let browser = '';
  for (const [name, pattern] of browsers) {
    if (pattern.test(agent)) { browser = `${name} ${version(agent, pattern)}`.trim(); break; }
  }
  let system = '';
  if (/Windows NT/.test(agent)) system = 'Windows';
  else if (/iPhone|iPad|iPod/.test(agent)) system = `iOS ${version(agent, /OS (\d+(?:_\d+)?)/).replace('_', '.')}`.trim();
  else if (/Android/.test(agent)) system = `Android ${version(agent, /Android (\d+(?:\.\d+)?)/)}`.trim();
  else if (/Mac OS X/.test(agent)) system = 'macOS';
  else if (/CrOS/.test(agent)) system = 'ChromeOS';
  else if (/Linux/.test(agent)) system = 'Linux';
  return { browser, system };
}

// One line for emails, exports and lists; empty when nothing was recorded.
export function environmentSummary(env) {
  if (!env) return '';
  const { browser, system } = parseAgent(env.userAgent);
  return [browser, system, env.viewport && env.viewport.replace('x', '×'), env.timeZone].filter(Boolean).join(' · ');
}
