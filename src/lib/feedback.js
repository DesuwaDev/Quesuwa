// Global confirmation dialogs and toast notifications rendered by FeedbackHost.
import { reactive } from 'vue';

export const dialogState = reactive({ current: null });
export const toasts = reactive([]);
let toastId = 0;

function open(options) {
  return new Promise(resolve => {
    dialogState.current?.resolve(options.prompt ? null : false);
    dialogState.current = { danger: false, confirmKey: 'common.confirm', value: '', ...options, resolve };
  });
}

// Keys are translated at render time so open dialogs follow language changes.
export const confirmDialog = options => open({ prompt: false, ...options });
export const promptDialog = options => open({ prompt: true, ...options });

export function closeDialog(result) {
  const dialog = dialogState.current;
  if (!dialog) return;
  dialogState.current = null;
  dialog.resolve(result);
}

export function notify(key, { params = {}, type = 'success', text = '', timeout = 3600, action = null } = {}) {
  const id = ++toastId;
  toasts.push({ id, key, params, type, text, action });
  if (toasts.length > 4) toasts.shift();
  if (timeout) setTimeout(() => dismiss(id), timeout);
  return id;
}

export const notifyError = error => notify(error?.code || 'errors.operation', { params: error?.params || {}, type: 'error', timeout: 6000 });

export function dismiss(id) {
  const index = toasts.findIndex(item => item.id === id);
  if (index >= 0) toasts.splice(index, 1);
}
