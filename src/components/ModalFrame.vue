<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../i18n.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({ title: String, size: { type: String, default: 'md' }, closable: { type: Boolean, default: true } });
const emit = defineEmits(['close']);
const panel = ref(null);
let previous = null;
let lockedOverflow = '';

function close() { if (props.closable) emit('close'); }

function trap(event) {
  if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab' || !panel.value) return;
  const focusable = [...panel.value.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

onMounted(async () => {
  previous = document.activeElement;
  lockedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  await nextTick();
  const target = panel.value?.querySelector('[autofocus], input:not([type=hidden]), textarea, select') || panel.value?.querySelector('.modal-actions .button.primary, .modal-actions .button.danger') || panel.value;
  target?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  document.body.style.overflow = lockedOverflow;
  previous?.focus?.({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="close">
      <div ref="panel" class="modal-panel" :class="'modal-' + size" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="trap">
        <header v-if="title || $slots.header" class="modal-header">
          <slot name="header"><h2>{{ title }}</h2></slot>
          <button v-if="closable" type="button" class="icon-button ghost" :aria-label="t('common.close')" @click="close"><AppIcon name="close" /></button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.actions" class="modal-actions"><slot name="actions" /></footer>
      </div>
    </div>
  </Teleport>
</template>
