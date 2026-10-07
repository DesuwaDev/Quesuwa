// Browser details attached to a response when the questionnaire asks for diagnostics.
const referrer = document.referrer;

export function collectEnvironment() {
  const nav = window.navigator;
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* Very old browsers. */ }
  return {
    userAgent: nav.userAgent || '',
    platform: nav.userAgentData?.platform || nav.platform || '',
    mobile: nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/.test(nav.userAgent || ''),
    touch: (nav.maxTouchPoints || 0) > 0,
    screen: `${window.screen.width}x${window.screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio || 1,
    language: nav.language || '',
    timeZone,
    colorScheme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    referrer,
    page: window.location.pathname + window.location.search
  };
}
