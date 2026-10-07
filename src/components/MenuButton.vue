<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({ label: String, icon: { type: String, default: 'more' }, text: String, align: { type: String, default: 'end' }, buttonClass: { type: String, default: 'icon-button' }, disabled: Boolean });
const open = ref(false);
const root = ref(null), menu = ref(null);
// The menu is placed in the page root with fixed coordinates, so scrolling panels, cards and
// narrow screens can never cut it off; it opens wherever there is room.
const placement = ref({ visibility: 'hidden', top: '0px', left: '0px' });
const GAP = 6, MARGIN = 8;

function onDocument(event) {
  if (!root.value?.contains(event.target) && !menu.value?.contains(event.target)) close();
}
// When the page or a panel scrolls (or the window resizes) the menu follows its button;
// it closes only once the button has scrolled out of sight.
let frame = 0;
function follow(event) {
  if (event?.type === 'scroll' && menu.value?.contains(event.target)) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const trigger = root.value?.querySelector('.menu-trigger')?.getBoundingClientRect();
    if (!trigger || trigger.bottom < 0 || trigger.top > window.innerHeight || !trigger.width) return close();
    place();
  });
}
function close() {
  open.value = false;
  cancelAnimationFrame(frame);
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('scroll', follow, true);
  window.removeEventListener('resize', follow);
}

function place() {
  const trigger = root.value?.querySelector('.menu-trigger')?.getBoundingClientRect();
  if (!trigger || !menu.value) return;
  const width = menu.value.offsetWidth, height = menu.value.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth, viewportHeight = window.innerHeight;
  // Prefer the requested side, flip when it would leave the screen, then clamp to the edges.
  let left = props.align === 'start' ? trigger.left : trigger.right - width;
  if (left + width > viewportWidth - MARGIN) left = trigger.right - width;
  if (left < MARGIN) left = trigger.left;
  left = Math.min(Math.max(MARGIN, left), viewportWidth - width - MARGIN);
  let top = trigger.bottom + GAP;
  if (top + height > viewportHeight - MARGIN && trigger.top - GAP - height >= MARGIN) top = trigger.top - GAP - height;
  top = Math.max(MARGIN, Math.min(top, viewportHeight - height - MARGIN));
  placement.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` };
}

async function toggle() {
  if (open.value) return close();
  placement.value = { visibility: 'hidden', top: '0px', left: '0px' };
  open.value = true;
  document.addEventListener('pointerdown', onDocument, true);
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  await nextTick();
  place();
  menu.value?.querySelector('button:not([disabled]), a')?.focus({ preventScroll: true });
}
function keydown(event) {
  if (!open.value) return;
  // Escape only closes the menu, not the panel or dialog it sits in.
  if (event.key === 'Escape') { event.stopPropagation(); close(); root.value?.querySelector('.menu-trigger')?.focus(); return; }
  if (event.key === 'Tab') { close(); return; }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const items = [...(menu.value?.querySelectorAll('button:not([disabled]), a') || [])];
  const index = items.indexOf(document.activeElement);
  items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}
// Closing from a menu item returns focus to the button, as keyboard users expect.
function choose() {
  close();
  root.value?.querySelector('.menu-trigger')?.focus({ preventScroll: true });
}
onBeforeUnmount(close);
defineExpose({ close });
</script>

<template>
  <div ref="root" class="menu" @keydown="keydown">
    <button type="button" class="menu-trigger" :class="props.buttonClass" :aria-label="label" :title="label" aria-haspopup="menu" :aria-expanded="open" :disabled="disabled" @click="toggle">
      <AppIcon v-if="icon" :name="icon" /><span v-if="text">{{ text }}</span><AppIcon v-if="text" name="chevronDown" :size="14" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="menu" class="menu-popover floating" :style="placement" role="menu" @click="choose" @keydown="keydown">
        <slot />
      </div>
    </Teleport>
  </div>
</template>
