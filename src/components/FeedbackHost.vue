<script setup>
import { computed } from 'vue';
import { t } from '../i18n.js';
import { dialogState, closeDialog, toasts, dismiss } from '../lib/feedback.js';
import ModalFrame from './ModalFrame.vue';
import AppIcon from './AppIcon.vue';

const dialog = computed(() => dialogState.current);
const blocked = computed(() => Boolean(dialog.value?.prompt && dialog.value.expected && dialog.value.value !== dialog.value.expected));
const label = (key, params) => key ? t(key, params || {}) : '';

function submit() {
  if (blocked.value) return;
  closeDialog(dialog.value.prompt ? dialog.value.value : true);
}
const cancel = () => closeDialog(dialog.value?.prompt ? null : false);
const toastIcon = { success: 'checkCircle', error: 'alert', info: 'info' };
</script>

<template>
  <ModalFrame v-if="dialog" :title="label(dialog.titleKey, dialog.params)" size="sm" @close="cancel">
    <form class="dialog-form" @submit.prevent="submit">
      <div class="dialog-message" :class="{ danger: dialog.danger }">
        <span class="dialog-badge"><AppIcon :name="dialog.danger ? 'alert' : 'info'" :size="20" /></span>
        <p class="preserve">{{ label(dialog.messageKey, dialog.params) }}</p>
      </div>
      <label v-if="dialog.prompt" class="field">
        <span v-if="dialog.expected" class="field-label">{{ t('dialog.typeToConfirm', { value: dialog.expected }) }}</span>
        <input v-model="dialog.value" class="input" :placeholder="dialog.expected || ''" autocomplete="off" autofocus />
      </label>
      <div class="modal-actions inline">
        <button type="button" class="button" @click="cancel">{{ t('common.cancel') }}</button>
        <button type="submit" class="button" :class="dialog.danger ? 'danger' : 'primary'" :disabled="blocked">{{ label(dialog.confirmKey, dialog.params) }}</button>
      </div>
    </form>
  </ModalFrame>
  <Teleport to="body">
    <div class="toast-region" aria-live="polite" role="status">
      <TransitionGroup name="toast">
        <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type">
          <AppIcon :name="toastIcon[toast.type] || 'info'" />
          <span>{{ toast.text || label(toast.key, toast.params) }}</span>
          <button v-if="toast.action" type="button" class="text-button small" @click="toast.action.run(); dismiss(toast.id)">{{ t(toast.action.key) }}</button>
          <button type="button" class="icon-button ghost small" :aria-label="t('common.close')" @click="dismiss(toast.id)"><AppIcon name="close" :size="14" /></button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
