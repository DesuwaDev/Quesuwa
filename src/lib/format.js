import { locale, t } from '../i18n.js';

export function formatDate(value, { time = true, dateStyle = 'medium' } = {}) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale.value, time ? { dateStyle, timeStyle: 'short' } : { dateStyle }).format(date);
}

export function formatDay(value, options = { month: 'short', day: 'numeric' }) {
  const date = new Date(value + 'T00:00:00');
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale.value, options).format(date) : value;
}

export function relativeTime(value) {
  if (!value) return '';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 45) return t('time.justNow');
  if (abs < 3600) return format.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return format.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return format.format(Math.round(diff / 86400), 'day');
  return formatDate(value, { time: false });
}

export const formatNumber = (value, options) => value === null || value === undefined ? '—' : new Intl.NumberFormat(locale.value, options).format(value);
export const formatPercent = (part, total) => total ? new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(part / total) : '—';

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return t('size.bytes', { value: formatNumber(bytes) });
  if (bytes < 1024 * 1024) return t('size.kb', { value: formatNumber(bytes / 1024, { maximumFractionDigits: 1 }) });
  if (bytes < 1024 ** 3) return t('size.mb', { value: formatNumber(bytes / 1024 ** 2, { maximumFractionDigits: 1 }) });
  return t('size.gb', { value: formatNumber(bytes / 1024 ** 3, { maximumFractionDigits: 2 }) });
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t('time.seconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesSeconds', { minutes, seconds: seconds % 60 });
  return t('time.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export const shortId = id => String(id || '').slice(0, 8).toUpperCase();

// Converts between ISO timestamps and <input type="datetime-local"> values.
export function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const fromLocalInput = value => value ? new Date(value).toISOString() : '';

// Start of a local calendar day as an ISO timestamp (for range filters).
export function localDayStart(day, offsetDays = 0) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date + offsetDays).toISOString();
}
export const todayKey = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export function shiftDay(day, delta) {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + delta));
  return next.toISOString().slice(0, 10);
}

// Simplified device description for session lists.
export function describeAgent(agent = '') {
  const browser = /Edg\//.test(agent) ? 'Edge' : /OPR\//.test(agent) ? 'Opera' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '';
  const system = /Windows/.test(agent) ? 'Windows' : /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android' : /Mac OS X/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
  return [browser, system].filter(Boolean).join(' · ') || t('account.unknownDevice');
}
