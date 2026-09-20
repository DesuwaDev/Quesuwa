<script setup>
import { t } from './i18n.js';
const props = defineProps({ settings: { type: Object, required: true } });
function localDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function setDate(key, value) { props.settings[key] = value ? new Date(value).toISOString() : ''; }
</script>
<template>
  <section class="panel settings-panel">
    <h3>{{ t('settings.collection') }}</h3>
    <label class="stack-label"><span>{{ t('settings.startsAt') }}</span><input type="datetime-local" :value="localDate(settings.startsAt)" @change="setDate('startsAt', $event.target.value)" /></label>
    <label class="stack-label"><span>{{ t('settings.endsAt') }}</span><input type="datetime-local" :value="localDate(settings.endsAt)" @change="setDate('endsAt', $event.target.value)" /></label>
    <label class="stack-label"><span>{{ t('settings.responseLimit') }}</span><input type="number" v-model.number="settings.responseLimit" min="0" max="1000000" /><small>{{ t('settings.limitHint') }}</small></label>
    <label class="check-row"><input type="checkbox" v-model="settings.listed" />{{ t('settings.listed') }}</label>
    <label class="check-row"><input type="checkbox" v-model="settings.showProgress" />{{ t('settings.showProgress') }}</label>
    <label class="stack-label"><span>{{ t('settings.submitLabel') }}</span><input v-model="settings.submitLabel" maxlength="60" :placeholder="t('form.submit')" /></label>
    <label class="stack-label"><span>{{ t('settings.consent') }}</span><textarea v-model="settings.consentText" maxlength="2000" rows="3" :placeholder="t('settings.consentHint')"></textarea></label>
  </section>
</template>
