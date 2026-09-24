<script setup>
import { computed, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { t } from '../../i18n.js';
import { copyText } from '../../lib/clipboard.js';
import { notify } from '../../lib/feedback.js';
import { linkHandler } from '../../lib/router.js';
import AppIcon from '../../components/AppIcon.vue';

const props = defineProps({ form: Object, dirty: Boolean });
const url = computed(() => window.location.origin + '/f/' + props.form.slug);
const svg = ref(''), png = ref('');
const live = computed(() => props.form.state === 'published' && !props.form.deletedAt);
const protectedForm = computed(() => Boolean(props.form.settings?.accessCode));

watch(url, async value => {
  const options = { margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2B2322', light: '#FFFFFF' } };
  try {
    svg.value = await QRCode.toString(value, { ...options, type: 'svg' });
    png.value = await QRCode.toDataURL(value, { ...options, width: 720 });
  } catch { svg.value = ''; png.value = ''; }
}, { immediate: true });

async function copy(value, key = 'share.copied') {
  if (await copyText(value)) notify(key);
}
const invitation = computed(() => t('share.invitation', { title: props.form.title, url: url.value }) + (protectedForm.value ? '\n' + t('share.invitationCode', { code: props.form.settings.accessCode }) : ''));
</script>

<template>
  <div class="share-layout">
    <section class="card share-card">
      <header class="card-header"><h2><AppIcon name="link" :size="18" />{{ t('share.linkTitle') }}</h2></header>
      <div v-if="!live" class="banner warning"><AppIcon name="alert" :size="16" /><span>{{ t('share.notLive') }}</span><a class="text-button small" :href="'/admin/forms/' + form.id + '/settings'" @click="linkHandler('/admin/forms/' + form.id + '/settings')($event)">{{ t('share.goPublish') }}</a></div>
      <div v-if="dirty" class="banner info"><AppIcon name="info" :size="16" />{{ t('share.unsaved') }}</div>
      <div class="share-url">
        <input class="input mono" :value="url" readonly :aria-label="t('share.linkTitle')" @focus="$event.target.select()" />
        <button type="button" class="button primary" @click="copy(url)"><AppIcon name="copy" :size="16" />{{ t('common.copy') }}</button>
        <a class="button" :href="url" target="_blank" rel="noopener"><AppIcon name="external" :size="16" /><span class="hide-narrow">{{ t('share.open') }}</span></a>
      </div>
      <div v-if="protectedForm" class="share-code">
        <AppIcon name="lock" :size="16" />
        <span>{{ t('share.codeRequired') }}</span>
        <code>{{ form.settings.accessCode }}</code>
        <button type="button" class="icon-button ghost small" :aria-label="t('common.copy')" @click="copy(form.settings.accessCode)"><AppIcon name="copy" :size="14" /></button>
      </div>
      <div class="field">
        <span class="field-label">{{ t('share.invitationLabel') }}</span>
        <textarea class="input textarea" rows="4" readonly :value="invitation"></textarea>
        <button type="button" class="button small align-start" @click="copy(invitation)"><AppIcon name="copy" :size="14" />{{ t('share.copyInvitation') }}</button>
      </div>
    </section>

    <section class="card share-card qr-card">
      <header class="card-header"><h2><AppIcon name="qr" :size="18" />{{ t('share.qrTitle') }}</h2></header>
      <div class="qr-frame" role="img" :aria-label="t('share.qrTitle')" v-html="svg"></div>
      <p class="muted small center">{{ t('share.qrHint') }}</p>
      <a v-if="png" class="button" :href="png" :download="form.slug + '-qr.png'"><AppIcon name="download" :size="16" />{{ t('share.downloadQr') }}</a>
    </section>
  </div>
</template>
