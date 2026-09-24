import { reactive } from 'vue';
import { languageHeaders, apiError } from '../i18n.js';
import { can } from '../../shared/constants.js';

export const session = reactive({ user: null, checked: false });
export const allowed = permission => can(session.user?.role, permission);

export async function api(url, { method = 'GET', body, headers = {}, signal } = {}) {
  const init = { method, headers: { ...languageHeaders(), ...headers }, signal };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  let response;
  try { response = await fetch('/api' + url, init); }
  catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw apiError(null, 'errors.network');
  }
  let data = null;
  try { data = await response.json(); } catch { /* Empty or non-JSON body. */ }
  if (!response.ok) {
    if (response.status === 401 && url.startsWith('/admin') && url !== '/admin/login') session.user = null;
    throw Object.assign(apiError(data, 'errors.operation'), { status: response.status });
  }
  return data;
}

// Builds a query string, skipping empty values.
export function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '' && value !== false) search.set(key, String(value));
  const text = search.toString();
  return text ? '?' + text : '';
}

export const timezoneOffset = () => new Date().getTimezoneOffset();
