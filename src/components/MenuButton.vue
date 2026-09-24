<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({ label: String, icon: { type: String, default: 'more' }, text: String, align: { type: String, default: 'end' }, buttonClass: { type: String, default: 'icon-button' }, disabled: Boolean });
const open = ref(false);
const root = ref(null), menu = ref(null);
const up = ref(false);

function onDocument(event) { if (!root.value?.contains(event.target)) close(); }
function close() {
  open.value = false;
  document.removeEventListener('pointerdown', onDocument, true);
}
async function toggle() {
  if (open.value) return close();
  open.value = true;
  document.addEventListener('pointerdown', onDocument, true);
  await nextTick();
  // Open upwards when the menu would overflow the bottom of the viewport.
  const rect = menu.value?.getBoundingClientRect();
  up.value = Boolean(rect && rect.bottom > window.innerHeight - 8 && rect.top - rect.height > 60);
  menu.value?.querySelector('button:not([disabled]), a')?.focus({ preventScroll: true });
}
function keydown(event) {
  if (!open.value) return;
  if (event.key === 'Escape') { close(); root.value?.querySelector('.menu-trigger')?.focus(); return; }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const items = [...(menu.value?.querySelectorAll('button:not([disabled]), a') || [])];
  const index = items.indexOf(document.activeElement);
  items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}
onBeforeUnmount(close);
defineExpose({ close });
</script>

<template>
  <div ref="root" class="menu" @keydown="keydown">
    <button type="button" class="menu-trigger" :class="props.buttonClass" :aria-label="label" :title="label" aria-haspopup="menu" :aria-expanded="open" :disabled="disabled" @click="toggle">
      <AppIcon v-if="icon" :name="icon" /><span v-if="text">{{ text }}</span><AppIcon v-if="text" name="chevronDown" :size="14" />
    </button>
    <div v-if="open" ref="menu" class="menu-popover" :class="{ start: align === 'start', up }" role="menu" @click="close">
      <slot />
    </div>
  </div>
</template>
