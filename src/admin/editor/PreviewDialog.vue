<script setup>
import { ref } from 'vue';
import { t } from '../../i18n.js';
import ModalFrame from '../../components/ModalFrame.vue';
import AppIcon from '../../components/AppIcon.vue';
import QuestionnaireForm from '../../public/QuestionnaireForm.vue';

defineProps({ form: { type: Object, required: true } });
const emit = defineEmits(['close']);
const device = ref('desktop'), attempt = ref(0);
</script>

<template>
  <ModalFrame :title="t('editor.preview')" size="full" @close="emit('close')">
    <template #header>
      <h2>{{ t('editor.preview') }}</h2>
      <div class="segmented" role="group" :aria-label="t('preview.device')">
        <button type="button" :class="{ active: device === 'desktop' }" :aria-pressed="device === 'desktop'" @click="device = 'desktop'"><AppIcon name="monitor" :size="16" /><span class="hide-narrow">{{ t('preview.desktop') }}</span></button>
        <button type="button" :class="{ active: device === 'phone' }" :aria-pressed="device === 'phone'" @click="device = 'phone'"><AppIcon name="phone" :size="16" /><span class="hide-narrow">{{ t('preview.phone') }}</span></button>
      </div>
      <button type="button" class="button ghost small" @click="attempt++"><AppIcon name="refresh" :size="16" /><span class="hide-narrow">{{ t('preview.restart') }}</span></button>
      <span class="spacer"></span>
    </template>
    <p class="banner info"><AppIcon name="info" :size="16" />{{ t('preview.note') }}</p>
    <div class="preview-stage" :class="device">
      <div class="preview-surface form-page" :class="'accent-' + (form.settings?.accent || 'coral')">
        <QuestionnaireForm :key="attempt" :form="form" preview />
      </div>
    </div>
  </ModalFrame>
</template>
