<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { t, locale } from '../i18n.js';
import { REACTIONS } from '../../shared/reactions.js';
import AppIcon from './AppIcon.vue';

// Reactions under a message (emoji, count, who) and a small palette to add or remove one.
// Each reaction is { emoji, count, mine, names }.
const props = defineProps({ reactions: { type: Array, default: () => [] }, canReact: Boolean });
const emit = defineEmits(['toggle']);
const open = ref(false);
const root = ref(null), palette = ref(null), trigger = ref(null);
const placement = ref({ visibility: 'hidden', top: '0px', left: '0px' });
const GAP = 6, MARGIN = 8;

const mine = emoji => props.reactions.some(item => item.emoji === emoji && item.mine);
const who = names => names.length ? new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(names) : '';

// The palette sits in the page root with fixed coordinates and opens wherever there is room.
function place() {
  const anchor = trigger.value?.getBoundingClientRect();
  if (!anchor || !palette.value) return;
  const width = palette.value.offsetWidth, height = palette.value.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth, viewportHeight = window.innerHeight;
  const left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2), viewportWidth - width - MARGIN);
  let top = anchor.top - GAP - height;
  if (top < MARGIN) top = anchor.bottom + GAP;
  top = Math.max(MARGIN, Math.min(top, viewportHeight - height - MARGIN));
  placement.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` };
}
function onDocument(event) {
  if (!root.value?.contains(event.target) && !palette.value?.contains(event.target)) close();
}
function close() {
  open.value = false;
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('scroll', place, true);
  window.removeEventListener('resize', place);
}
async function toggle() {
  if (open.value) return close();
  placement.value = { visibility: 'hidden', top: '0px', left: '0px' };
  open.value = true;
  document.addEventListener('pointerdown', onDocument, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  await nextTick();
  place();
  palette.value?.querySelector('button')?.focus({ preventScroll: true });
}
function pick(emoji) {
  emit('toggle', emoji, !mine(emoji));
  close();
  trigger.value?.focus({ preventScroll: true });
}
function keydown(event) {
  if (event.key === 'Escape') { event.stopPropagation(); close(); trigger.value?.focus(); return; }
  if (event.key === 'Tab') return close();
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[event.key];
  if (!step) return;
  event.preventDefault();
  const items = [...(palette.value?.querySelectorAll('button') || [])];
  const index = items.indexOf(document.activeElement);
  items[Math.min(items.length - 1, Math.max(0, index + step))]?.focus();
}
onBeforeUnmount(close);
</script>

<template>
  <span ref="root" class="reactions" :class="{ empty: !reactions.length }">
    <button
      v-for="item in reactions"
      :key="item.emoji"
      type="button"
      class="reaction-chip"
      :class="{ mine: item.mine }"
      :aria-pressed="item.mine"
      :disabled="!canReact"
      :title="who(item.names)"
      :aria-label="t('reactions.chip', { emoji: item.emoji, count: item.count, names: who(item.names) })"
      @click="emit('toggle', item.emoji, !item.mine)"
    ><span class="reaction-emoji" aria-hidden="true">{{ item.emoji }}</span><span class="reaction-count">{{ item.count }}</span></button>
    <button v-if="canReact" ref="trigger" type="button" class="reaction-add" :aria-label="t('reactions.add')" :title="t('reactions.add')" aria-haspopup="menu" :aria-expanded="open" @click="toggle">
      <AppIcon name="smilePlus" :size="15" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="palette" class="reaction-palette" :style="placement" role="menu" :aria-label="t('reactions.add')" @keydown="keydown">
        <button
          v-for="emoji in REACTIONS"
          :key="emoji"
          type="button"
          class="reaction-option"
          :class="{ mine: mine(emoji) }"
          role="menuitemcheckbox"
          :aria-checked="mine(emoji)"
          @click="pick(emoji)"
        ><span class="reaction-emoji">{{ emoji }}</span></button>
      </div>
    </Teleport>
  </span>
</template>
