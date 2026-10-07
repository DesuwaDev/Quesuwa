<script setup>
import { computed, onMounted, ref } from 'vue';
import { t } from '../../i18n.js';
import { api } from '../../lib/api.js';
import { notify, notifyError } from '../../lib/feedback.js';
import AppIcon from '../../components/AppIcon.vue';
import CaptchaWidget from '../../components/CaptchaWidget.vue';

// Workspace-wide verification channels. Questionnaires opt in one by one in their settings.
const PROVIDERS = ['cap', 'turnstile', 'hcaptcha', 'recaptcha', 'recaptchaV3'];
const NAMES = { cap: 'Cap', turnstile: 'Cloudflare Turnstile', hcaptcha: 'hCaptcha', recaptcha: 'Google reCAPTCHA v2', recaptchaV3: 'Google reCAPTCHA v3' };
const CONSOLES = { turnstile: 'https://dash.cloudflare.com/?to=/:account/turnstile', hcaptcha: 'https://dashboard.hcaptcha.com/sites', recaptcha: 'https://www.google.com/recaptcha/admin', recaptchaV3: 'https://www.google.com/recaptcha/admin', cap: 'https://capjs.js.org/guide/standalone/' };

const form = ref(null), saved = ref(''), status = ref({ ready: {}, accepted: [] }), live = ref(null), saving = ref(false);
const revealed = ref({});
const test = ref(null), testing = ref(false), testResult = ref(null), widgetKey = ref(0);
const dirty = computed(() => Boolean(form.value) && JSON.stringify(form.value) !== saved.value);
// Every channel in use gets its settings: primary, backup, and channels Cap failures are routed to.
const routed = computed(() => usesCap.value ? [form.value.capBlockedFallback, form.value.capNetworkFallback].filter(id => PROVIDERS.includes(id)) : []);
const shown = computed(() => form.value ? [...new Set([form.value.provider, form.value.fallback, ...routed.value])].filter(id => PROVIDERS.includes(id)) : []);
const roleOf = id => id === form.value.provider ? 'captcha.primaryBadge' : id === form.value.fallback ? 'captcha.fallbackBadge' : 'captcha.capRouteBadge';
const usesCap = computed(() => form.value && (form.value.provider === 'cap' || form.value.fallback === 'cap'));
const standalone = id => id !== 'cap' || form.value.providers.cap.mode === 'standalone';

function adopt(data) {
  const { ready, accepted, ...config } = data.config;
  form.value = config;
  saved.value = JSON.stringify(config);
  status.value = { ready, accepted };
  live.value = data.public;
  testResult.value = null;
  widgetKey.value++;
}
async function load() {
  try { adopt(await api('/admin/system/captcha')); } catch (error) { notifyError(error); }
}
async function save() {
  saving.value = true;
  try { adopt(await api('/admin/system/captcha', { method: 'PUT', body: form.value })); notify('captcha.saved'); }
  catch (error) { notifyError(error); }
  finally { saving.value = false; }
}

// Verifies a real token against the saved setup, exactly like a submission would.
async function runTest() {
  testing.value = true;
  testResult.value = null;
  try {
    const verification = await test.value?.getToken();
    if (!verification) { testResult.value = 'missing'; return; }
    const { ok } = await api('/admin/system/captcha/verify', { method: 'POST', body: verification });
    testResult.value = ok ? 'ok' : 'rejected';
  } catch (error) { notifyError(error); }
  finally { testing.value = false; test.value?.reset(); }
}
const toggle = id => { revealed.value = { ...revealed.value, [id]: !revealed.value[id] }; };
onMounted(load);
</script>

<template>
  <section class="card captcha-card">
    <header class="card-header">
      <h2><AppIcon name="shield" :size="18" />{{ t('captcha.title') }}</h2>
      <span v-if="form" class="badge" :class="dirty ? 'warning' : status.accepted.length ? 'success' : 'muted'">{{ dirty ? t('captcha.unsaved') : status.accepted.length ? t('captcha.live', { channels: status.accepted.map(id => NAMES[id]).join(' / ') }) : t('captcha.off') }}</span>
    </header>
    <template v-if="form">
      <p class="muted small">{{ t('captcha.intro') }}</p>
      <div class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('captcha.primary') }}</span>
          <select v-model="form.provider" class="input select">
            <option value="none">{{ t('captcha.off') }}</option>
            <option v-for="id in PROVIDERS" :key="id" :value="id">{{ NAMES[id] }}</option>
          </select>
          <small class="hint">{{ t('captcha.keepHint') }}</small>
        </label>
        <label class="field">
          <span class="field-label">{{ t('captcha.fallback') }}</span>
          <select v-model="form.fallback" class="input select" :disabled="form.provider === 'none'">
            <option value="none">{{ t('captcha.noFallback') }}</option>
            <option v-for="id in PROVIDERS.filter(item => item !== form.provider)" :key="id" :value="id">{{ NAMES[id] }}</option>
          </select>
          <small class="hint">{{ t('captcha.fallbackHint') }}</small>
        </label>
      </div>

      <div class="captcha-sections">
      <fieldset v-for="id in shown" :key="id" class="captcha-provider">
        <legend><strong>{{ NAMES[id] }}</strong><span class="badge" :class="status.ready[id] ? 'success' : 'muted'">{{ t(roleOf(id)) }}</span></legend>
        <template v-if="id === 'cap'">
          <div class="chip-group">
            <label class="radio-chip"><input v-model="form.providers.cap.mode" type="radio" value="builtin" />{{ t('captcha.capBuiltin') }}</label>
            <label class="radio-chip"><input v-model="form.providers.cap.mode" type="radio" value="standalone" />{{ t('captcha.capStandalone') }}</label>
          </div>
          <template v-if="form.providers.cap.mode === 'builtin'">
            <p class="hint small">{{ t('captcha.capBuiltinHint') }}</p>
            <label class="field">
              <span class="field-label">{{ t('captcha.capStrength') }}</span>
              <select v-model="form.providers.cap.strength" class="input select">
                <option value="low">{{ t('captcha.strengthLow') }}</option>
                <option value="medium">{{ t('captcha.strengthMedium') }}</option>
                <option value="high">{{ t('captcha.strengthHigh') }}</option>
              </select>
            </label>
          </template>
          <template v-else>
            <p class="hint small">{{ t('captcha.capStandaloneHint') }}</p>
            <label class="field">
              <span class="field-label">{{ t('captcha.serverUrl') }}</span>
              <input v-model.trim="form.providers.cap.serverUrl" class="input mono" type="url" :placeholder="t('captcha.serverUrlPlaceholder')" />
              <small class="hint">{{ t('captcha.serverUrlHint') }}</small>
            </label>
            <label class="field">
              <span class="field-label">{{ t('captcha.verificationServerUrl') }}</span>
              <input v-model.trim="form.providers.cap.verificationServerUrl" class="input mono" type="url" :placeholder="t('captcha.verificationServerUrlPlaceholder')" />
              <small class="hint">{{ t('captcha.verificationServerUrlHint') }}</small>
            </label>
          </template>
          <div class="inline-fields">
            <label class="field">
              <span class="field-label">{{ t('captcha.workerCount') }}</span>
              <select v-model="form.providers.cap.workerCount" class="input select">
                <option value="auto">{{ t('captcha.workersAuto') }}</option>
                <option v-for="count in ['1', '2', '4', '8']" :key="count" :value="count">{{ count }}</option>
              </select>
              <small class="hint">{{ t('captcha.workerCountHint') }}</small>
            </label>
            <label v-if="form.providers.cap.mode === 'standalone'" class="field">
              <span class="field-label">{{ t('captcha.timeout') }}</span>
              <select v-model="form.providers.cap.timeout" class="input select">
                <option v-for="seconds in ['5', '10', '20', '30']" :key="seconds" :value="seconds">{{ t('captcha.seconds', { count: Number(seconds) }) }}</option>
              </select>
            </label>
          </div>
        </template>
        <div v-if="standalone(id)" class="inline-fields">
          <label class="field">
            <span class="field-label">{{ t('captcha.siteKey') }}</span>
            <input v-model.trim="form.providers[id].siteKey" class="input mono" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('captcha.secret') }}</span>
            <span class="input-affix">
              <input v-model.trim="form.providers[id].secret" class="input mono" :type="revealed[id] ? 'text' : 'password'" autocomplete="off" spellcheck="false" />
              <button type="button" class="icon-button ghost small" :aria-label="revealed[id] ? t('admin.hidePassword') : t('admin.showPassword')" :aria-pressed="Boolean(revealed[id])" @click="toggle(id)"><AppIcon :name="revealed[id] ? 'eyeOff' : 'eye'" :size="16" /></button>
            </span>
          </label>
        </div>
        <label v-if="id === 'recaptcha' || id === 'recaptchaV3'" class="field">
          <span class="field-label">{{ t('captcha.endpoint') }}</span>
          <select v-model="form.providers[id].endpoint" class="input select">
            <option value="auto">{{ t('captcha.endpointAuto') }}</option>
            <option value="global">{{ t('captcha.endpointGlobal') }}</option>
            <option value="china">{{ t('captcha.endpointChina') }}</option>
          </select>
        </label>
        <label v-if="id === 'recaptchaV3'" class="field">
          <span class="field-label">{{ t('captcha.threshold') }}</span>
          <input v-model.number="form.providers.recaptchaV3.threshold" class="input" type="number" min="0" max="1" step="0.1" />
          <small class="hint">{{ t('captcha.thresholdHint') }}</small>
        </label>
        <a v-if="standalone(id)" class="text-button small" :href="CONSOLES[id]" target="_blank" rel="noopener noreferrer"><AppIcon name="external" :size="14" />{{ id === 'cap' ? t('captcha.capDocs') : t('captcha.getKeys') }}</a>
      </fieldset>

      <fieldset v-if="usesCap && form.provider !== 'none'" class="captcha-provider">
        <legend><strong>{{ t('captcha.capFailure') }}</strong></legend>
        <div class="inline-fields">
          <label v-for="field in ['capBlockedFallback', 'capNetworkFallback']" :key="field" class="field">
            <span class="field-label">{{ field === 'capBlockedFallback' ? t('captcha.capBlockedLabel') : t('captcha.capNetworkLabel') }}</span>
            <select v-model="form[field]" class="input select">
              <option value="none">{{ t('captcha.policyNone') }}</option>
              <option value="default">{{ t('captcha.policyDefault') }}</option>
              <option v-for="id in PROVIDERS.filter(item => item !== 'cap')" :key="id" :value="id">{{ NAMES[id] }}</option>
            </select>
          </label>
        </div>
        <p class="hint small">{{ t('captcha.capFailureHint') }}</p>
      </fieldset>

      <fieldset v-if="form.provider !== 'none'" class="captcha-provider">
        <legend><strong>{{ t('captcha.appearance') }}</strong></legend>
        <div class="inline-fields">
        <label class="field">
          <span class="field-label">{{ t('captcha.theme') }}</span>
          <select v-model="form.theme" class="input select">
            <option value="auto">{{ t('captcha.themeAuto') }}</option>
            <option value="light">{{ t('captcha.themeLight') }}</option>
            <option value="dark">{{ t('captcha.themeDark') }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">{{ t('captcha.size') }}</span>
          <select v-model="form.size" class="input select">
            <option value="normal">{{ t('captcha.sizeNormal') }}</option>
            <option value="compact">{{ t('captcha.sizeCompact') }}</option>
          </select>
        </label>
        </div>
      </fieldset>
      </div>
      <div><button type="button" class="button primary small" :disabled="saving || !dirty" @click="save">{{ t('common.save') }}</button></div>

      <div v-if="live" class="captcha-test">
        <h3 class="subheading"><AppIcon name="checkCircle" :size="16" />{{ t('captcha.testTitle') }}</h3>
        <p class="muted small">{{ t('captcha.testIntro') }}</p>
        <CaptchaWidget :key="widgetKey" ref="test" :config="live" />
        <div class="button-row">
          <button type="button" class="button small" :disabled="testing || dirty" @click="runTest"><AppIcon name="send" :size="14" />{{ testing ? t('common.loading') : t('captcha.testRun') }}</button>
          <span v-if="dirty" class="muted small">{{ t('webhook.saveFirst') }}</span>
          <span v-if="testResult === 'ok'" class="badge success">{{ t('captcha.testOk') }}</span>
          <span v-else-if="testResult === 'rejected'" class="badge danger">{{ t('captcha.testRejected') }}</span>
          <span v-else-if="testResult === 'missing'" class="badge warning">{{ t('errors.captchaRequired') }}</span>
        </div>
      </div>
    </template>
  </section>
</template>
