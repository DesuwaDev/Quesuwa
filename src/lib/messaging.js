import { reactive } from 'vue';
import { api } from './api.js';

// Which notification channels are configured, plus shared reply templates.
export const messaging = reactive({ alerts: false, mail: false, alertMail: false, templates: [], loaded: false });
let pending = null;

export function loadMessaging(force = false) {
  if (messaging.loaded && !force) return Promise.resolve(messaging);
  pending ??= api('/admin/messaging')
    .then(data => Object.assign(messaging, data, { loaded: true }))
    .catch(() => messaging)
    .finally(() => { pending = null; });
  return pending;
}
