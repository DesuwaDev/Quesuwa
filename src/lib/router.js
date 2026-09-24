// Minimal history router with an async leave guard for unsaved work.
import { reactive } from 'vue';

const parse = () => ({
  path: window.location.pathname.replace(/\/+$/, '') || '/',
  query: Object.fromEntries(new URLSearchParams(window.location.search))
});

export const route = reactive(parse());
let currentUrl = window.location.pathname + window.location.search;
const guards = new Set();

function apply({ scroll = true } = {}) {
  currentUrl = window.location.pathname + window.location.search;
  const next = parse();
  route.path = next.path;
  route.query = next.query;
  if (scroll) window.scrollTo({ top: 0 });
}

async function allowLeave(target) {
  for (const guard of [...guards]) if (!(await guard(target))) return false;
  return true;
}

// Registers a guard; returns a function that removes it.
export function addLeaveGuard(guard) {
  guards.add(guard);
  return () => guards.delete(guard);
}

export async function navigate(to, { replace = false, force = false } = {}) {
  if (to === currentUrl) return true;
  const target = new URL(to, window.location.origin);
  const samePath = target.pathname.replace(/\/+$/, '') === route.path;
  if (!force && !samePath && !(await allowLeave(target.pathname.replace(/\/+$/, '') || '/'))) return false;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', target.pathname + target.search + target.hash);
  apply({ scroll: !samePath });
  return true;
}

// Updates query parameters on the current page without adding history noise.
export function updateQuery(changes, { replace = true } = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null || value === '' || value === false) params.delete(key);
    else params.set(key, String(value));
  }
  const search = params.toString();
  return navigate(window.location.pathname + (search ? '?' + search : ''), { replace });
}

window.addEventListener('popstate', async () => {
  const target = window.location.pathname + window.location.search;
  const samePath = (window.location.pathname.replace(/\/+$/, '') || '/') === route.path;
  if (!samePath && !(await allowLeave(window.location.pathname.replace(/\/+$/, '') || '/'))) {
    window.history.pushState({}, '', currentUrl);
    return;
  }
  if (target !== currentUrl) apply({ scroll: !samePath });
});

window.addEventListener('beforeunload', event => {
  if (guards.size && [...guards].some(guard => guard.dirty?.())) {
    event.preventDefault();
    event.returnValue = '';
  }
});

export function linkHandler(to) {
  return event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
}
