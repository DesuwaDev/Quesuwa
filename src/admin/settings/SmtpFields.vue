<script setup>
import { t } from '../../i18n.js';
import ToggleSwitch from '../../components/ToggleSwitch.vue';
import AppIcon from '../../components/AppIcon.vue';

// One SMTP profile. `profile.pass` is write-only: empty keeps the stored password.
const props = defineProps({ profile: { type: Object, required: true }, kind: { type: String, default: 'alert' } });
const presets = [
  { key: 'smtpPreset.qq', host: 'smtp.qq.com', port: 465, security: 'tls' },
  { key: 'smtpPreset.exmail', host: 'smtp.exmail.qq.com', port: 465, security: 'tls' },
  { key: 'smtpPreset.netease', host: 'smtp.163.com', port: 465, security: 'tls' },
  { key: 'smtpPreset.aliyun', host: 'smtp.qiye.aliyun.com', port: 465, security: 'tls' },
  { key: 'smtpPreset.gmail', host: 'smtp.gmail.com', port: 465, security: 'tls' },
  { key: 'smtpPreset.outlook', host: 'smtp.office365.com', port: 587, security: 'starttls' }
];
const ports = { tls: 465, starttls: 587, none: 25 };
function applyPreset(index) {
  const preset = presets[Number(index)];
  if (preset) Object.assign(props.profile, { host: preset.host, port: preset.port, security: preset.security });
}
// Keep the port in step with the security mode unless it was customised.
function setSecurity(value) {
  if (Object.values(ports).includes(Number(props.profile.port))) props.profile.port = ports[value];
  props.profile.security = value;
}
const recipientsText = {
  get: () => (props.profile.recipients || []).join('\n'),
  set: value => { props.profile.recipients = value.split(/[\s,;，；]+/).map(item => item.trim()).filter(Boolean); }
};
</script>

<template>
  <div class="smtp-fields">
    <ToggleSwitch v-model="profile.enabled" :label="t('notifyCenter.enable')" />
    <div class="inline-fields">
      <label class="field">
        <span class="field-label">{{ t('notifyCenter.preset') }}</span>
        <select class="input select" :value="''" @change="applyPreset($event.target.value); $event.target.value = ''">
          <option value="" disabled>{{ t('notifyCenter.presetPick') }}</option>
          <option v-for="(preset, index) in presets" :key="preset.host" :value="index">{{ t(preset.key) }}</option>
        </select>
      </label>
      <label class="field grow">
        <span class="field-label">{{ t('notifyCenter.host') }}</span>
        <input v-model.trim="profile.host" class="input mono" autocomplete="off" spellcheck="false" :placeholder="t('notifyCenter.hostPlaceholder')" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('notifyCenter.security') }}</span>
        <select class="input select" :value="profile.security" @change="setSecurity($event.target.value)">
          <option value="tls">{{ t('notifyCenter.securityTls') }}</option>
          <option value="starttls">{{ t('notifyCenter.securityStarttls') }}</option>
          <option value="none">{{ t('notifyCenter.securityNone') }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">{{ t('notifyCenter.port') }}</span>
        <input v-model.number="profile.port" class="input" type="number" min="1" max="65535" />
      </label>
    </div>
    <div class="inline-fields">
      <label class="field">
        <span class="field-label">{{ t('notifyCenter.user') }}</span>
        <input v-model.trim="profile.user" class="input" autocomplete="off" spellcheck="false" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('notifyCenter.pass') }}</span>
        <span class="input-affix">
          <input v-model="profile.pass" class="input" type="password" autocomplete="new-password" :placeholder="profile.hasPass && !profile.clearPass ? t('notifyCenter.passKept') : t('notifyCenter.passPlaceholder')" @input="profile.clearPass = false" />
          <button v-if="profile.hasPass && !profile.clearPass" type="button" class="button ghost small" @click="profile.clearPass = true; profile.pass = ''">{{ t('notifyCenter.clear') }}</button>
        </span>
        <small class="hint">{{ profile.clearPass ? t('notifyCenter.passWillClear') : t('notifyCenter.passHint') }}</small>
      </label>
    </div>
    <div class="inline-fields">
      <label class="field">
        <span class="field-label">{{ t('notifyCenter.fromName') }}</span>
        <input v-model="profile.fromName" class="input" maxlength="80" :placeholder="t('app.brand')" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('notifyCenter.fromAddress') }}</span>
        <input v-model.trim="profile.fromAddress" class="input" type="email" autocomplete="off" :placeholder="t('form.emailPlaceholder')" />
      </label>
      <label v-if="kind === 'mail'" class="field">
        <span class="field-label">{{ t('notifyCenter.replyTo') }}</span>
        <input v-model.trim="profile.replyTo" class="input" type="email" autocomplete="off" :placeholder="t('notifyCenter.replyToPlaceholder')" />
      </label>
    </div>
    <label v-if="kind === 'alert'" class="field">
      <span class="field-label">{{ t('notifyCenter.recipients') }}</span>
      <textarea class="input textarea mono" rows="2" :value="recipientsText.get()" :placeholder="t('notifyCenter.recipientsPlaceholder')" @change="recipientsText.set($event.target.value)"></textarea>
      <small class="hint">{{ t('notifyCenter.recipientsHint') }}</small>
    </label>
    <p class="hint small"><AppIcon name="info" :size="14" />{{ t('notifyCenter.authHint') }}</p>
  </div>
</template>
