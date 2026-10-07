<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t, locale } from '../i18n.js';
import { mountCaptcha } from '../lib/captcha.js';
import { nextCaptchaChannel } from '../../shared/captcha-routing.js';
import AppIcon from './AppIcon.vue';

// Human verification before submitting. When the primary channel cannot load (blocked network,
// broken key) the backup channel takes over by itself.
const props = defineProps({ config: { type: Object, required: true } });
const emit = defineEmits(['token']);
const host = ref(null), status = ref('loading'), current = ref(null), switched = ref(false), failure = ref('unavailable');
let handle = null, token = '', generation = 0, tried = [];

const labels = computed(() => ({
  'initial-state': t('captcha.capInitial'), 'verifying-label': t('captcha.capVerifying'), 'solved-label': t('captcha.capSolved'), 'error-label': t('captcha.capError'),
  'verify-aria-label': t('captcha.capInitial'), 'verifying-aria-label': t('captcha.capVerifying'), 'verified-aria-label': t('captcha.capSolved'), 'error-aria-label': t('captcha.capError'),
  'wasm-disabled': t('captcha.capSlow'), 'required-label': t('errors.captchaRequired')
}));
const setToken = value => { token = value || ''; emit('token', token); };

async function mount(channel) {
  const attempt = ++generation;
  try { handle?.dispose(); } catch { /* Already removed. */ }
  handle = null;
  setToken('');
  current.value = channel;
  status.value = 'loading';
  host.value?.replaceChildren();
  try {
    const mounted = await mountCaptcha(host.value, channel, {
      theme: props.config.theme, size: props.config.size, locale: locale.value, labels: labels.value,
      onToken: setToken, onUnavailable: kind => { if (attempt === generation) unavailable(channel, kind); }
    });
    if (attempt !== generation) return mounted.dispose();
    handle = mounted;
    status.value = 'ready';
  } catch { if (attempt === generation) unavailable(channel, 'unavailable'); }
}

// Cap refusals and Cap network trouble follow their own routes; any other failure of the
// primary channel moves to the general backup. A channel is never tried twice.
function unavailable(channel, kind) {
  const target = nextCaptchaChannel(props.config, channel.provider, kind, tried);
  if (target) {
    tried.push(target.provider);
    switched.value = true;
    mount(target);
  } else {
    failure.value = kind;
    status.value = 'failed';
  }
}

// The token for this submission, or null when the visitor has not verified yet.
async function getToken() {
  if (!current.value) return null;
  if (handle?.execute) {
    try { return { provider: current.value.provider, token: await handle.execute() }; }
    catch { return null; }
  }
  return token ? { provider: current.value.provider, token } : null;
}
// Tokens are single-use: after a rejected submission the widget starts over.
function reset() {
  setToken('');
  try { handle?.reset(); } catch { /* Provider already gone. */ }
}
function start() {
  tried = [props.config.primary.provider];
  switched.value = false;
  mount(props.config.primary);
}

onMounted(start);
onBeforeUnmount(() => { generation++; try { handle?.dispose(); } catch { /* Already removed. */ } });
defineExpose({ getToken, reset });
</script>

<template>
  <div class="captcha-box" :class="{ silent: current?.provider === 'recaptchaV3' }">
    <div ref="host" class="captcha-host"></div>
    <p v-if="status === 'loading'" class="captcha-status muted small"><span class="spinner small"></span>{{ t('captcha.loading') }}</p>
    <p v-else-if="status === 'ready' && current?.provider === 'recaptchaV3'" class="captcha-status muted small"><AppIcon name="shield" :size="14" />{{ t('captcha.silentNote') }}</p>
    <p v-if="switched && status !== 'failed'" class="captcha-status muted small"><AppIcon name="info" :size="14" />{{ t('captcha.switched') }}</p>
    <p v-if="status === 'failed'" class="captcha-status field-error small" role="alert">
      <AppIcon name="alert" :size="14" /><span>{{ failure === 'blocked' ? t('captcha.capBlocked') : failure === 'network' ? t('captcha.capNetwork') : t('captcha.failed') }}</span>
      <button type="button" class="text-button small" @click="start">{{ t('common.retry') }}</button>
    </p>
  </div>
</template>
